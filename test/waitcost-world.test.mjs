import assert from "node:assert/strict";
import test from "node:test";
import { WAITCOST_PATTERNS as patterns, WAITCOST_SUITE as suite, PRICE_CENTS, waitcostCases,
  createWaitcost, observeWaitcost, stepWaitcost, waitcostCalls, verifyWaitcost } from "../docs/lib/waitcost.js";
import { LASTSLOT_PATTERNS } from "../docs/lib/lastslot.js";
import { TARIFF_PATTERNS } from "../docs/lib/tariff.js";
import { LOADCHOICE_PATTERNS, LOADCHOICE_SUITE, createLoadchoice, observeLoadchoice, stepLoadchoice, verifyLoadchoice } from "../docs/lib/loadchoice.js";
import { PAID_PATTERNS } from "../docs/lib/paid.js";
import { BOOKING_PATTERNS } from "../docs/lib/booking.js";
import { SURVEY_PATTERNS } from "../docs/lib/survey.js";
import { RALLY_PATTERNS } from "../docs/lib/rally.js";
import { TRUST_PATTERNS } from "../docs/lib/trust.js";
import { CLOSES_PATTERNS } from "../docs/lib/closes.js";
import { TURNS_PATTERNS } from "../docs/lib/turns.js";
import { DRIFT_PATTERNS } from "../docs/lib/drift.js";

const previous={...DRIFT_PATTERNS,...TURNS_PATTERNS,...CLOSES_PATTERNS,...TRUST_PATTERNS,...RALLY_PATTERNS,
  ...SURVEY_PATTERNS,...BOOKING_PATTERNS,...PAID_PATTERNS,...TARIFF_PATTERNS,...LASTSLOT_PATTERNS,...LOADCHOICE_PATTERNS};
const signature = levels=>levels.slice(1).map((v,i)=>Math.sign(v-levels[i])).join("/");
const splits=suite.splits;

test("training and held-out market draws use only public structural rules and disjoint openings",()=>{
  const oldPaths=Object.values(previous).map(p=>p.levels);
  const occupied=new Set(oldPaths.map(p=>p.slice(0,5).join("/")));
  const shapes=new Set(oldPaths.map(signature)), trialStarts=new Set();
  let rng=191;
  function choose(options) {
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    return options[Math.floor(rng/4294967296*options.length)];
  }
  const levels=[0,1,2,3,4],low=[0,1],high=[3,4];
  for(const name of ["validation","test"]) {
    for(const stratum of ["reversal","interrupted-drop"]) {
      const reversal=stratum==="reversal";
      const stems=splits[name].families.filter(k=>patterns[k].stratum===stratum && patterns[k].ending==="cold");
      assert.equal(stems.length,name==="validation"?1:4);
      for(const [i,key] of stems.entries()) {
        const cold=patterns[key],hot=patterns[cold.stem+"-hot"];
        const contrary = reversal ? i%2===1 : i%2===0;
        for(let attempt=0;;attempt++) {
          assert(attempt<100000);
          const head=[2,choose(reversal?low:high),choose(levels),choose(levels),choose(levels)];
          const prefix=head.join("/"), short=head.slice(0,4).join("/");
          if(occupied.has(prefix) || trialStarts.has(short))continue;
          if(reversal ? Math.max(...head.slice(2))<3 : Math.min(...head.slice(2))>1)continue;
          const a=[...head,choose(contrary?high:low),choose(low),0];
          const b=[...head,choose(contrary?low:high),choose(high),4];
          if(shapes.has(signature(a))||shapes.has(signature(b)))continue;
          assert.deepEqual(cold.levels,a);assert.deepEqual(hot.levels,b);
          assert.equal(cold.prefixLength,5);assert.equal(hot.prefixLength,5);
          assert(!Object.hasOwn(previous,key));assert(!Object.hasOwn(previous,cold.stem+"-hot"));
          occupied.add(prefix);shapes.add(signature(a));shapes.add(signature(b));
          trialStarts.add(short);
          break;
        }
      }
    }
  }
  assert.equal(trialStarts.size,10);
});

test("disjoint seed banks and complete cent schedules are stable across all four public manifests",()=>{
  assert.deepEqual(PRICE_CENTS,[0,5,10,25,50,75,100]);
  assert.deepEqual(splits.train.families,LOADCHOICE_SUITE.splits.train.families);
  assert.equal(splits.train.families.length,121);
  assert.deepEqual(splits.retention.families,["interrupted-drop"]);
  assert.deepEqual(splits.archive.families,LOADCHOICE_SUITE.splits.test.families);
  const counts={validation:896,test:114688,retention:7168,archive:14336};
  let prior=LOADCHOICE_SUITE.splits.archive.start+LOADCHOICE_SUITE.splits.archive.count;
  for (const [name,s] of Object.entries(splits)) {
    assert(s.start>=prior); prior=s.start+s.count;
    if(name==="train") {
      assert.deepEqual(waitcostCases(name).next().value,{split:name,seed:s.start,family:s.families[0],priceCents:0});
      continue;
    }
    const cases=waitcostCases(name);
    assert.equal(cases.length,counts[name]);
    for(const [i,row] of cases.entries()) {
      const tape=Math.floor(i/PRICE_CENTS.length);
      assert.equal(row.family,s.families[tape%s.families.length]);
      assert.equal(row.seed,s.start+Math.floor(tape/s.families.length));
      assert.equal(row.priceCents,PRICE_CENTS[i%PRICE_CENTS.length]);
      assert.equal(row.split,name);
    }
  }
  assert.throws(()=>waitcostCases("__proto__"),RangeError);
});

test("paired gates with zero, one and two slots conceal the same future, preserve prices and charge a purchase once",()=>{
  for(const family of splits.test.families.filter(f=>patterns[f].ending==="cold")) for(const slots of [0,1,2]) {
    const open=Array.from({length:5},(_,i)=>i<2-slots ? "accept" : "pass");
    const stem=patterns[family].stem, priceCents=37;
    const a=createWaitcost({seed:593,family,priceCents});
    const b=createWaitcost({seed:593,family:stem+"-hot",priceCents});
    for(const id of open) {stepWaitcost(a,id);stepWaitcost(b,id);}
    const o=observeWaitcost(a);
    assert.deepEqual(o,observeWaitcost(b));
    assert.equal(o.slots,slots);assert.equal(o.phase,"survey");assert.equal(o.offer,null);assert.equal(o.reading,null);
    assert.equal(o.history.length,5);assert.deepEqual(waitcostCalls(o).map(x=>x.id),["buy","skip"]);
    const bought=structuredClone(a);
    stepWaitcost(bought,"buy");stepWaitcost(a,"skip");
    assert(Number.isInteger(observeWaitcost(bought).reading));assert.equal(observeWaitcost(a).reading,null);
    for(const state of [bought,a]) while(!state.done) stepWaitcost(state,state.slots ? "accept" : "pass");
    const yes=verifyWaitcost(bought), no=verifyWaitcost(a);
    assert.deepEqual(yes.violations,[]);assert.deepEqual(no.violations,[]);
    assert.equal(yes.grossCents,no.grossCents);assert.equal(yes.netCents,no.netCents-priceCents);
    for(const mutate of [s=>s.reading=(s.reading+1)%7,s=>s.feeCents++,s=>s.grossCents++,s=>s.netCents++,s=>s.calls[0].id="buy"]) {
      const changed=structuredClone(bought);mutate(changed);assert(verifyWaitcost(changed).violations.length);
    }
  }
});

test("earlier training, retention and archive fixtures have the exact prior cent-ledger and public observations",()=>{
  for(const name of ["train","retention","archive"]) for(const family of splits[name].families.filter(k=>Object.hasOwn(LOADCHOICE_PATTERNS,k))) {
    for(const cents of [0,37,100]) {
      const config={seed:419,family,priceCents:cents},a=createWaitcost(config),b=createLoadchoice(config);
      assert.deepEqual(a,b);
      while(!a.done) {
        const o=observeWaitcost(a);
        assert.deepEqual(o,observeLoadchoice(b));
        const act=o.phase==="survey" ? "buy" : o.wave===2 || o.wave===6 ? "accept" : "pass";
        stepWaitcost(a,act);stepLoadchoice(b,act);
      }
      assert.deepEqual(verifyWaitcost(a),verifyLoadchoice(b));
    }
  }
  assert.throws(()=>createWaitcost({seed:0,family:"__proto__"}),RangeError);
  assert.throws(()=>createWaitcost({seed:0,priceCents:0.5}),RangeError);
});
