import assert from "node:assert/strict";
import test from "node:test";
import { createBooking, observeBooking, stepBooking, BOOKING_PATTERNS, BOOKING_SUITE } from "../docs/lib/booking.js";
import { SURVEY_PATTERNS, SURVEY_SUITE } from "../docs/lib/survey.js";
import { RALLY_PATTERNS } from "../docs/lib/rally.js";
import { TRUST_PATTERNS } from "../docs/lib/trust.js";
import { CLOSES_PATTERNS } from "../docs/lib/closes.js";
import { TURNS_PATTERNS } from "../docs/lib/turns.js";
import { DRIFT_PATTERNS } from "../docs/lib/drift.js";
import { PAID_PATTERNS, PAID_SUITE, paidCases, createPaid, observePaid, paidCalls, stepPaid, verifyPaid } from "../docs/lib/paid.js";

const { splits } = PAID_SUITE;
const earlier = Object.values({ ...DRIFT_PATTERNS, ...TURNS_PATTERNS, ...CLOSES_PATTERNS, ...TRUST_PATTERNS,
  ...RALLY_PATTERNS, ...SURVEY_PATTERNS, ...BOOKING_PATTERNS });
const fixtures = [39, 172, 422, 0xffffffff];
const timing = path => path.slice(1).map((v,i) => Math.sign(v-path[i])).join("/");

test("held-out scopes, schedules, survey sources and paired freight draws are frozen", () => {
  const paths = earlier.map(p => p.levels), seen = new Set(paths.map(timing));
  const stems = [];
  for (const split of ["validation","test"]) {
    const scope = splits[split].families.map(f=>PAID_PATTERNS[f]);
    for (const p of scope.filter(p => p.ending === "cold")) {
      const twin = PAID_PATTERNS[p.stem + "-hot"], prefix = p.levels.slice(0,p.prefixLength);
      assert.equal(p.prefixLength,twin.levels.findIndex((v,i) => v !== p.levels[i]));
      assert.ok(paths.every(path => prefix.some((v,i) => v !== path[i])));
      for (const q of [p,twin]) {
        assert.ok(!seen.has(timing(q.levels)));
        seen.add(timing(q.levels));
        assert.equal(q.levels.length,8);
        assert.ok(q.levels.every(v => Number.isInteger(v) && v>=0 && v<=4));
        assert.equal(q.levels[7],q.ending === "cold" ? 0 : 4);
      }
      stems.push(prefix.slice(0,4).join("/"));
      for (const seed of fixtures) {
        const a = createPaid({seed,family:p.stem+"-cold"}), b = createPaid({seed,family:p.stem+"-hot"});
        for (let wave = 0; wave < p.prefixLength; wave++) {
          assert.deepEqual(observePaid(a),observePaid(b));
          stepPaid(a,"pass"); stepPaid(b,"pass");
        }
        if (p.prefixLength === 5) assert.deepEqual(observePaid(a),observePaid(b));
        for (let wave=0;wave<8;wave++) {
          const diff = a.trueHighChances[wave]-b.trueHighChances[wave];
          const price = a.offers[wave].net-b.offers[wave].net;
          assert.ok(price===0 || Math.sign(price)===Math.sign(diff));
        }
      }
      paths.push(p.levels,twin.levels);
    }
    if (split==="test") for (const stratum of ["reversal","interrupted-drop"]) {
      const cold = scope.filter(p=>p.ending==="cold" && p.stratum===stratum);
      assert.deepEqual(cold.map(p=>Math.sign(p.levels[5]-PAID_PATTERNS[p.stem+"-hot"].levels[5])).sort(),[-1,1]);
    }
  }
  assert.equal(new Set(stems).size,6);
  assert.deepEqual(splits.train.families,BOOKING_SUITE.splits.train.families);
  assert.deepEqual(splits.archive.families,BOOKING_SUITE.splits.test.families);
  assert.deepEqual(splits.surveyArchive.families,SURVEY_SUITE.splits.test.families);
  assert.deepEqual(splits.retention.families,["interrupted-drop"]);
  let last=BOOKING_SUITE.splits.archive.start+BOOKING_SUITE.splits.archive.count-1;
  for (const [split,{start,count,families}] of Object.entries(splits)) {
    assert.ok(start>last); last=start+count-1;
    if (split==="train") continue;
    const rows = paidCases(split);
    assert.equal(rows.length,count*families.length);
    assert.deepEqual(rows[0],{split,seed:start,family:families[0]});
    assert.deepEqual(rows.at(-1),{split,seed:last,family:families.at(-1)});
  }
  assert.throws(()=>paidCases("constructor"),RangeError);
  assert.throws(()=>createPaid({seed:-1}),RangeError);
  assert.throws(()=>createPaid({seed:0,family:"__proto__"}),RangeError);
  assert.throws(()=>createPaid({seed:0,fee:-1}),RangeError);
});

test("survey precedes the sixth offer, charges exactly once, and preserves the freight tape", () => {
  const allowed = ["capacity","done","feePaid","forecast","gross","history","horizon","net","offer","phase","quote","reading","slots","surveyAction","surveyFee","wave"];
  for (const seed of fixtures) for (const family of ["double-trough-hot","interrupted-drop"]) {
    const shifts = ["buy","skip","free"].map(mode=>createPaid({seed,family,fee:mode==="free"?0:1}));
    for (let w=0;w<8;w++) {
      if (w===5) {
        for (const [i,s] of shifts.entries()) {
          const o=observePaid(s);
          assert.deepEqual(Object.keys(o).sort(),allowed);
          assert.deepEqual([o.phase,o.wave,o.history.length,o.offer,o.reading,o.surveyAction],["survey",5,5,null,null,null]);
          assert.equal(o.quote.high,s.board[5].high);
          assert.equal(o.quote.highChance,o.history[4].quote.highChance);
          assert.equal(o.forecast.length,2);
          assert.deepEqual(paidCalls(o).map(c=>c.id),["buy","skip"]);
          assert.equal(verifyPaid(s).violations.length,0);
          // Switching only the unreleased price, future quotes or signal cannot leak into the gate.
          const unseen=structuredClone(s);
          unseen.offers[5].net+=500; unseen.trueHighChances[5]=0; unseen.board[6].highChance=1;
          assert.deepEqual(observePaid(unseen),o);
          assert.throws(()=>stepPaid(s,"pass"),RangeError);
          stepPaid(s,i===1?"skip":"buy");
          assert.throws(()=>stepPaid(s,"buy"),RangeError);
          assert.equal(s.wave,5);
        }
      }
      for (const [i,s] of shifts.entries()) {
        const o=observePaid(s);
        assert.equal(o.phase,"freight");
        assert.deepEqual(o.offer,shifts[1].offers[w]);
        assert.equal(o.history.length,w);
        assert.equal(o.net,o.gross-o.feePaid);
        assert.equal(o.feePaid,w>=5 && i===0 ? 1 : 0);
        if (w<5 || i===1) assert.equal(o.reading,null);
        else {assert.ok(Number.isInteger(o.reading) && o.reading>=0 && o.reading<=6); assert.equal(o.reading,shifts[0].reading);}
        const action = w===0 || w===2 ? "accept" : "pass";
        stepPaid(s,action);
        assert.equal(verifyPaid(s).violations.length,0);
      }
    }
    const [buy,skip,free]=shifts.map(verifyPaid);
    assert.equal(buy.gross,skip.gross); assert.equal(free.gross,buy.gross);
    assert.equal(buy.net,skip.net-1); assert.equal(free.net,skip.net);
    assert.ok(buy.bought && free.bought && !skip.bought);
    assert.equal(buy.feePaid,1); assert.equal(buy.reading,free.reading); assert.equal(skip.reading,null);
    assert.equal(shifts[0].slots,0);assert.deepEqual(paidCalls(observePaid(shifts[0])),[]);
    for (const mutate of [
      s=>{s.net++;s.feePaid=0;}, s=>{s.reading=(s.reading+1)%7;}, s=>{s.surveyAction=null;},
      s=>{s.loads[0].cost++;s.offers[0].cost++;s.net--;}, s=>{s.calls.push({wave:8,id:"buy"});},
    ]) {const bad=structuredClone(shifts[0]);mutate(bad);assert.ok(verifyPaid(bad).violations.length);}
  }
});

test("skipping exactly reproduces the releases used for training, retention and both archives", () => {
  for (const split of ["train","retention","archive","surveyArchive"]) for (const family of splits[split].families) {
    const config={family,seed:103}, a=createPaid(config), b=createBooking(config);
    assert.deepEqual(a.trueHighChances,b.trueHighChances);
    while (!a.done) {
      if (observePaid(a).phase==="survey") stepPaid(a,"skip");
      const {phase,reading,surveyFee,surveyAction,gross,feePaid,...publicFreight}=observePaid(a);
      assert.deepEqual(publicFreight,observeBooking(b));
      const action=a.wave===2 || a.wave===6?"accept":"pass";
      stepPaid(a,action);stepBooking(b,action);
    }
    assert.equal(verifyPaid(a).net,b.net);
  }
});
