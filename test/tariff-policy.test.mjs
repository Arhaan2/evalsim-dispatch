import assert from "node:assert/strict";
import test from "node:test";
import { compilePlanner, marketPrior } from "../docs/lib/paid-policy.js";
import { repriceOpening, tariffDecision } from "../docs/lib/tariff-policy.js";
import { PRICE_CENTS } from "../docs/lib/tariff.js";

test("six-sample value is compared with the exact fractional price before seeing the signed offer", () => {
  const model={gate:{"*":[20,45,20.13,45.37]}};
  const o={wave:5,slots:1,phase:"survey",quote:{low:8,high:22,highChance:0.2},reading:null,offer:null,
    history:Array.from({length:5},(_,wave)=>({wave,high:false,quote:{highChance:0.2}}))};
  for (let cents=0;cents<=100;cents++) {
    const q=tariffDecision({...o,priceCents:cents,surveyFee:cents/100},model);
    assert.equal(q.action,cents<13 ? "buy" : "skip");
    assert.ok(Math.abs(q.buyValue-(20.13-cents/100))<1e-12);
    assert.equal(q.skipValue,20);
  }
  assert.equal(tariffDecision({...o,slots:2,priceCents:29,surveyFee:0.29},model).action,"buy");
  assert.equal(tariffDecision({...o,slots:0,priceCents:71,surveyFee:0.71},model,"always").buyValue,-0.71);
});
test("the announced fee changes pre-survey bookings through fitted opening returns, including between grid points", () => {
  const model={early:Object.fromEntries(PRICE_CENTS.map(c=>[c,[{"*":[20.2-c/100,30]}]]))};
  const o={wave:0,phase:"freight",offer:{net:20},slots:1,history:[],quote:{low:10,high:20,highChance:0.5},reading:null};
  const decide=c=>tariffDecision({...o,priceCents:c,surveyFee:c/100},model);
  assert.equal(decide(10).action,"pass");
  assert.equal(decide(25).action,"accept");
  assert.equal(decide(19).action,"pass"); assert.equal(decide(20).action,"accept");
  assert.ok(Math.abs(decide(19).waitValue-20.01)<1e-10);
});
test("sharing the solved survey and post-acquisition tree preserves exact fee-dependent Bayesian Bellman values", () => {
  const prior=marketPrior([[0,1,0,0,2,3,4,4],[3,4,1,0,0,1,0,0],[1,2,0,3,3,0,1,4]]);
  const supports=[[8,20],[7,18],[6,26],[8,29],[5,27],[4,24],[4,32],[4,34]];
  const reusable=compilePlanner(supports,prior,0);
  for (const fee of [0.05,0.31,1]) {
    const solved=compilePlanner(supports,prior,fee);
    const repriced=repriceOpening(supports,prior,reusable.gate,fee);
    for (let w=0;w<5;w++) for(const [key,v] of solved.stages[w]) {
      const other=repriced[w].get(key);
      assert.ok(Math.abs(other[0]-v[0])<1e-9 && Math.abs(other[1]-v[1])<1e-9);
    }
    assert.deepEqual(reusable.gate,solved.gate);
  }
});
