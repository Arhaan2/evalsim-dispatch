import assert from "node:assert/strict";
import test from "node:test";
import { TARIFF_PATTERNS,TARIFF_SUITE,PRICE_CENTS,tariffCases,createTariff,observeTariff,tariffCalls,stepTariff,verifyTariff } from "../docs/lib/tariff.js";
import { PAID_PATTERNS,PAID_SUITE,createPaid,observePaid,stepPaid,verifyPaid } from "../docs/lib/paid.js";
import { BOOKING_PATTERNS } from "../docs/lib/booking.js";
import { SURVEY_PATTERNS } from "../docs/lib/survey.js";
import { RALLY_PATTERNS } from "../docs/lib/rally.js";
import { TRUST_PATTERNS } from "../docs/lib/trust.js";
import { CLOSES_PATTERNS } from "../docs/lib/closes.js";
import { TURNS_PATTERNS } from "../docs/lib/turns.js";
import { DRIFT_PATTERNS } from "../docs/lib/drift.js";

const old = Object.values({...DRIFT_PATTERNS,...TURNS_PATTERNS,...CLOSES_PATTERNS,...TRUST_PATTERNS,
  ...RALLY_PATTERNS,...SURVEY_PATTERNS,...BOOKING_PATTERNS,...PAID_PATTERNS}).map(p=>p.levels);
const timing = path => path.slice(1).map((v,i) => Math.sign(v-path[i])).join("/");
const {splits} = TARIFF_SUITE;

test("every released tape has seven matched prices and fresh openings and schedules", () => {
  assert.deepEqual(PRICE_CENTS,[0,5,10,25,50,75,100]);
  assert.deepEqual(splits.train.families,PAID_SUITE.splits.train.families);
  assert.deepEqual(splits.archive.families,PAID_SUITE.splits.test.families);
  assert.deepEqual(splits.retention.families,["interrupted-drop"]);
  const history=[...old], seen = new Set(history.map(timing)), openings = new Set();
  let previous = PAID_SUITE.splits.surveyArchive.start + PAID_SUITE.splits.surveyArchive.count;
  for (const [name,s] of Object.entries(splits)) {
    assert.ok(s.start >= previous);
    previous = s.start+s.count;
    if (name === "train") {
      assert.deepEqual(tariffCases(name).next().value,{split:name,seed:s.start,family:s.families[0],priceCents:0});
      continue;
    }
    const cases = tariffCases(name);
    assert.equal(cases.length,s.count*s.families.length*PRICE_CENTS.length);
    for (let i=0;i<cases.length;i+=PRICE_CENTS.length) {
      const group=cases.slice(i,i+PRICE_CENTS.length), tape=i/PRICE_CENTS.length;
      assert.deepEqual(group,PRICE_CENTS.map(priceCents=>({split:name,
        seed:s.start+Math.floor(tape/s.families.length),family:s.families[tape%s.families.length],priceCents})));
    }
    if (!["validation","test"].includes(name)) continue;
    const markets = s.families.map(f=>TARIFF_PATTERNS[f]);
    for (const p of markets.filter(q=>q.ending==="cold")) {
      const twin=TARIFF_PATTERNS[p.stem+"-hot"];
      assert.equal(p.prefixLength,twin.levels.findIndex((v,i)=>v!==p.levels[i]));
      assert.ok(history.every(path=>p.levels.slice(0,p.prefixLength).some((v,i)=>v!==path[i])));
      openings.add(p.levels.slice(0,4).join("/"));
      for (const q of [p,twin]) {
        assert.ok(!seen.has(timing(q.levels))); seen.add(timing(q.levels)); history.push(q.levels);
        assert.equal(q.levels.length,8);
        assert.ok(q.levels.every(v=>Number.isInteger(v) && v>=0 && v<=4));
        assert.equal(q.levels[7],q.ending==="cold"?0:4);
      }
    }
    if (name==="test") for (const stratum of ["reversal","interrupted-drop"]) {
      const cold=markets.filter(q=>q.stratum===stratum && q.ending==="cold");
      assert.deepEqual(cold.map(p=>Math.sign(p.levels[5]-TARIFF_PATTERNS[p.stem+"-hot"].levels[5])).sort(),[-1,1]);
    }
  }
  assert.equal(openings.size,6);
  assert.throws(()=>tariffCases("constructor"),RangeError);
});

test("price is public from the start; all cent ticks preserve blind gating and reconcile exactly", () => {
  for (const bad of [NaN,Infinity,null,"5",-1,101,0.5,15.4]) {
    assert.throws(()=>createTariff({seed:17,priceCents:bad}),RangeError);
  }
  assert.throws(()=>createTariff({seed:-1}),RangeError);
  assert.throws(()=>createTariff({seed:17,family:"__proto__"}),RangeError);
  for (const family of ["fast-lift-cold","trough-pause-hot","interrupted-drop"]) {
    const config={family,seed:292}, same=createTariff({...config,priceCents:0});
    let reading;
    for (let priceCents=0;priceCents<=100;priceCents++) {
      const s=createTariff({...config,priceCents});
      assert.deepEqual(s.offers,same.offers); assert.deepEqual(s.board,same.board);
      let o=observeTariff(s);
      assert.equal(o.surveyFee,priceCents/100);
      for (let i=0;i<5;i++) o=stepTariff(s,i===0?"accept":"pass");
      assert.equal(o.phase,"survey"); assert.equal(o.offer,null); assert.equal(o.reading,null);
      assert.equal(o.history.length,5); assert.equal(o.priceCents,priceCents);
      assert.deepEqual(tariffCalls(o).map(c=>c.id),["buy","skip"]);
      const concealed=structuredClone(s); concealed.offers[5].net+=1000; concealed.trueHighChances[5]=1;
      assert.deepEqual(observeTariff(concealed),o);
      assert.throws(()=>stepTariff(s,"accept"),RangeError);
      const skip=structuredClone(s);
      stepTariff(skip,"skip");
      o=stepTariff(s,"buy");
      reading ??= o.reading;
      assert.ok(Number.isInteger(reading) && reading>=0 && reading<=6);
      assert.equal(o.reading,reading); assert.equal(observeTariff(skip).reading,null);
      assert.equal(o.feeCents,priceCents);
      assert.throws(()=>stepTariff(s,"buy"),RangeError);
      for (const state of [s,skip]) {
        stepTariff(state,"accept"); stepTariff(state,"pass"); stepTariff(state,"pass");
      }
      const a=verifyTariff(s),b=verifyTariff(skip);
      assert.deepEqual(a.violations,[]); assert.deepEqual(b.violations,[]);
      assert.equal(a.grossCents,b.grossCents); assert.equal(a.netCents,b.netCents-priceCents);
      assert.equal(a.net,a.netCents/100); assert.equal(a.grossCents,a.netCents+a.feeCents);
      assert.equal(a.bought,true); assert.equal(b.bought,false);
      if(priceCents===23) for (const mutate of [v=>v.netCents++,v=>v.grossCents++,v=>v.feeCents++,
        v=>v.net++,v=>v.surveyFee++,v=>v.reading=(v.reading+1)%7,v=>v.loads[0].cost++,v=>v.surveyAction=null]) {
        const bad=structuredClone(s); mutate(bad); assert.ok(verifyTariff(bad).violations.length);
      }
    }
  }
});

test("at the endpoint prices all inherited tapes and charges match the fixed-price study", () => {
  for (const split of ["train","retention","archive"]) for (const family of splits[split].families) {
    for (const priceCents of [0,100]) for (const survey of ["skip","buy"]) {
      const config={family,seed:391}, a=createTariff({...config,priceCents}), b=createPaid({...config,fee:priceCents/100});
      assert.deepEqual(a.trueHighChances,b.trueHighChances);
      while(!a.done) {
        const {priceCents:price,grossCents,netCents,feeCents,...o}=observeTariff(a);
        assert.equal(price,priceCents); assert.equal(netCents,grossCents-feeCents); assert.deepEqual(o,observePaid(b));
        const id=o.phase==="survey"?survey:o.wave===1 || o.wave===6?"accept":"pass";
        stepTariff(a,id); stepPaid(b,id);
      }
      const {grossCents,netCents,feeCents,...score}=verifyTariff(a);
      assert.deepEqual(score,verifyPaid(b));
    }
  }
});
