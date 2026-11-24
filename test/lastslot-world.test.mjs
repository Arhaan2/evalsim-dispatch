import assert from "node:assert/strict";
import test from "node:test";
import { LASTSLOT_PATTERNS as patterns, LASTSLOT_SUITE as suite, PRICE_CENTS, lastslotCases,
  createLastslot, observeLastslot, stepLastslot, lastslotCalls, verifyLastslot } from "../docs/lib/lastslot.js";
import { TARIFF_PATTERNS, TARIFF_SUITE, createTariff, observeTariff, stepTariff, verifyTariff } from "../docs/lib/tariff.js";
import { PAID_PATTERNS } from "../docs/lib/paid.js";
import { BOOKING_PATTERNS } from "../docs/lib/booking.js";
import { SURVEY_PATTERNS } from "../docs/lib/survey.js";
import { RALLY_PATTERNS } from "../docs/lib/rally.js";
import { TRUST_PATTERNS } from "../docs/lib/trust.js";
import { CLOSES_PATTERNS } from "../docs/lib/closes.js";
import { TURNS_PATTERNS } from "../docs/lib/turns.js";
import { DRIFT_PATTERNS } from "../docs/lib/drift.js";

const previous={...DRIFT_PATTERNS,...TURNS_PATTERNS,...CLOSES_PATTERNS,...TRUST_PATTERNS,...RALLY_PATTERNS,
  ...SURVEY_PATTERNS,...BOOKING_PATTERNS,...PAID_PATTERNS,...TARIFF_PATTERNS};
const signature = levels=>levels.slice(1).map((v,i)=>Math.sign(v-levels[i])).join("/");
const splits=suite.splits;

test("the frozen schedule draw uses only structural novelty, demand stratum and aligned/contrary targets",()=>{
  const history=Object.values(previous).map(p=>p.levels), used=new Set(history.map(signature)), starts=new Set();
  let rng=171;
  function choose(options) {
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    return options[Math.floor(rng/4294967296*options.length)];
  }
  const allLevels=[0,1,2,3,4], low=[0,1], high=[3,4];
  for (const name of ["validation","test"]) {
    const markets=splits[name].families.map(k=>patterns[k]);
    for (const stratum of ["reversal","interrupted-drop"]) {
      const gates=markets.filter(p=>p.ending==="cold" && p.stratum===stratum);
      assert.equal(gates.length,name==="test"?4:1);
      for (const [index,cold] of gates.entries()) {
        const hot=patterns[cold.stem+"-hot"], reversal=stratum==="reversal";
        const contrary = reversal ? index%2===1 : index%2===0;
        let accepted=false;
        for(let i=0; i<100000 && !accepted; i++) {
          const opening=[2,choose(reversal?low:high),choose(allLevels),choose(allLevels),choose(allLevels)];
          const prefix=opening.slice(0,4).join("/");
          if(starts.has(prefix) || history.some(path=>opening.every((v,j)=>path[j]===v))) continue;
          if(reversal ? Math.max(...opening.slice(2))<3 : Math.min(...opening.slice(2))>1) continue;
          const a=[...opening,choose(contrary?high:low),choose(low),0];
          const b=[...opening,choose(contrary?low:high),choose(high),4];
          if(used.has(signature(a)) || used.has(signature(b))) continue;
          assert.deepEqual(cold.levels,a);assert.deepEqual(hot.levels,b);
          assert.equal(cold.prefixLength,5); assert.equal(hot.prefixLength,5);
          assert(!Object.hasOwn(previous,cold.stem+"-hot"));
          starts.add(prefix); history.push(a,b); used.add(signature(a)); used.add(signature(b));
          accepted=true;
        }
        assert(accepted);
      }
    }
  }
  assert.equal(starts.size,10);
});

test("disjoint seed banks and complete cent schedules are stable across all four public manifests",()=>{
  assert.deepEqual(PRICE_CENTS,[0,5,10,25,50,75,100]);
  assert.deepEqual(splits.train.families,TARIFF_SUITE.splits.train.families);
  assert.deepEqual(splits.retention.families,["interrupted-drop"]);
  assert.deepEqual(splits.archive.families,TARIFF_SUITE.splits.test.families);
  const counts={validation:896,test:114688,retention:7168,archive:7168};
  let prior=TARIFF_SUITE.splits.archive.start+TARIFF_SUITE.splits.archive.count;
  for (const [name,s] of Object.entries(splits)) {
    assert(s.start>=prior); prior=s.start+s.count;
    if(name==="train") {
      assert.deepEqual(lastslotCases(name).next().value,{split:name,seed:s.start,family:s.families[0],priceCents:0});
      continue;
    }
    const cases=lastslotCases(name);
    assert.equal(cases.length,counts[name]);
    for(const [i,row] of cases.entries()) {
      const tape=Math.floor(i/PRICE_CENTS.length);
      assert.equal(row.family,s.families[tape%s.families.length]);
      assert.equal(row.seed,s.start+Math.floor(tape/s.families.length));
      assert.equal(row.priceCents,PRICE_CENTS[i%PRICE_CENTS.length]);
      assert.equal(row.split,name);
    }
  }
  assert.throws(()=>lastslotCases("__proto__"),RangeError);
});

test("paired gates with zero, one and two slots conceal the same future, preserve prices and charge a purchase once",()=>{
  for(const family of splits.test.families.filter(f=>patterns[f].ending==="cold")) for(const slots of [0,1,2]) {
    const open=Array.from({length:5},(_,i)=>i<2-slots ? "accept" : "pass");
    const stem=patterns[family].stem, priceCents=37;
    const a=createLastslot({seed:593,family,priceCents});
    const b=createLastslot({seed:593,family:stem+"-hot",priceCents});
    for(const id of open) {stepLastslot(a,id);stepLastslot(b,id);}
    const o=observeLastslot(a);
    assert.deepEqual(o,observeLastslot(b));
    assert.equal(o.slots,slots);assert.equal(o.phase,"survey");assert.equal(o.offer,null);assert.equal(o.reading,null);
    assert.equal(o.history.length,5);assert.deepEqual(lastslotCalls(o).map(x=>x.id),["buy","skip"]);
    const bought=structuredClone(a);
    stepLastslot(bought,"buy");stepLastslot(a,"skip");
    assert(Number.isInteger(observeLastslot(bought).reading));assert.equal(observeLastslot(a).reading,null);
    for(const state of [bought,a]) while(!state.done) stepLastslot(state,state.slots ? "accept" : "pass");
    const yes=verifyLastslot(bought), no=verifyLastslot(a);
    assert.deepEqual(yes.violations,[]);assert.deepEqual(no.violations,[]);
    assert.equal(yes.grossCents,no.grossCents);assert.equal(yes.netCents,no.netCents-priceCents);
    for(const mutate of [s=>s.reading=(s.reading+1)%7,s=>s.feeCents++,s=>s.grossCents++,s=>s.netCents++,s=>s.calls[0].id="buy"]) {
      const changed=structuredClone(bought);mutate(changed);assert(verifyLastslot(changed).violations.length);
    }
  }
});

test("earlier training, retention and archive fixtures have the exact prior cent-ledger and public observations",()=>{
  for(const name of ["train","retention","archive"]) for(const family of splits[name].families) {
    for(const cents of [0,37,100]) {
      const config={seed:419,family,priceCents:cents},a=createLastslot(config),b=createTariff(config);
      assert.deepEqual(a,b);
      while(!a.done) {
        const o=observeLastslot(a);
        assert.deepEqual(o,observeTariff(b));
        const act=o.phase==="survey" ? "buy" : o.wave===2 || o.wave===6 ? "accept" : "pass";
        stepLastslot(a,act);stepTariff(b,act);
      }
      assert.deepEqual(verifyLastslot(a),verifyTariff(b));
    }
  }
  assert.throws(()=>createLastslot({seed:0,family:"__proto__"}),RangeError);
  assert.throws(()=>createLastslot({seed:0,priceCents:0.5}),RangeError);
});
