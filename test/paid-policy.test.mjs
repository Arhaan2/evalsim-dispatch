import assert from "node:assert/strict";
import test from "node:test";
import { compilePlanner, marketPrior, paidDecision, paidEvidence, paidRow, returnKeys, POLICY_SPEC } from "../docs/lib/paid-policy.js";

function gateObservation(fee=1) {
  return { wave:5,phase:"survey",done:false,slots:1,surveyFee:fee,reading:null,offer:null,
    quote:{low:4,high:30,highChance:0.7},history:[0,1,1,0,0].map((high,wave)=>({
      wave,high:Boolean(high),quote:{highChance:wave>=3 ? 0.7 : 0.4} })) };
}

test("buy/skip uses the blind paired continuation and the fee even for forced delivery with zero slots",()=>{
  const model={gate:{"*":[15,30,15.75,32]},stages:[]};
  const o=gateObservation();
  const d=paidDecision(o,model);
  assert.equal(d.action,"skip"); assert.equal(d.advantage,-0.25);
  assert.equal(d.buyValue,14.75); assert.equal(d.skipValue,15);
  assert.equal(paidDecision({...o,slots:2},model).action,"buy");
  assert.equal(paidDecision({...o,surveyFee:0},model).action,"buy");
  assert.equal(paidDecision({...o,slots:0},model,"always").advantage,-1);
  assert.equal(paidDecision({...o,slots:0},model,"always").action,"buy");
  assert.equal(paidDecision({...o,slots:0},model).action,"skip");
  assert.equal(paidDecision({...o,slots:2},model,"never").action,"skip");
});
test("zero sampled highs and an unopened survey can produce different optimal freight actions",()=>{
  const blind={...gateObservation(),phase:"freight",offer:{net:30}};
  const sampled={...blind,reading:0};
  const table={"*":[35,49]};
  table[returnKeys(paidEvidence(sampled)).at(-1)]=[20,49];
  const stages=Array(7); stages[5]=table;
  assert.equal(paidDecision(blind,{stages}).action,"pass");
  assert.equal(paidDecision(sampled,{stages}).action,"accept");
  assert.deepEqual(paidRow(table,paidEvidence(sampled)),[20,49]);
});

// Independently enumerate complete signed-price sequences on a synthetic
// market. First pool outcomes sharing a wave-seven information set, then
// optimize bookings backwards separately with masked and revealed samples.
test("Bayesian gate values equal independent signal-blind and signal-aware Bellman trees",()=>{
  const paths=[[2,1,3,0,1,0,0,0],[2,3,2,1,4,4,4,4]];
  const support=[[8,20],[7,18],[6,26],[8,29],[5,27],[4,24],[4,32],[4,34]];
  const prior=marketPrior(paths), table=compilePlanner(support,prior,1);
  const bits=6, bulletin1=7;
  const root=(bits+(bulletin1<<8));
  function acquisition(observed) {
    const branches=new Map();
    for (const levels of paths) for (const cold of [0.1,0.2]) for (const hot of [0.75,0.85]) {
      const p=levels.map(l=>cold+(hot-cold)*l/4);
      const signal=(value,k)=>{
        const match=[-0.1,0,0.1].filter(noise=>Math.max(1,Math.min(9,Math.round(10*(value+noise))))===k).length;
        return match*(1-POLICY_SPEC.diffuseBulletin)/3+POLICY_SPEC.diffuseBulletin/9;
      };
      let prefix=signal(p[1],bulletin1);
      for (let t=0;t<5;t++) prefix*=bits&(1<<t) ? p[t] : 1-p[t];
      for (let r=0;r<=6;r++) for (let w6=0;w6<=1;w6++) for (let b=1;b<=9;b++)
        for (let w7=0;w7<=1;w7++) for (let w8=0;w8<=1;w8++) {
          const mass=prefix*[1,6,15,20,15,6,1][r]*p[5]**r*(1-p[5])**(6-r)*
            (w6?p[5]:1-p[5])*signal(p[4],b)*(w7?p[6]:1-p[6])*(w8?p[7]:1-p[7]);
          const key=[observed?r:-1,w6,b,w7].join("/");
          const g=branches.get(key)??[0,0];
          g[0]+=mass; g[1]+=mass*support[7][w8]; branches.set(key,g);
        }
    }
    const next=new Map();
    for (const [key,[p,sum]] of branches) {
      const [r,w6,,w7]=key.split("/").map(Number);
      const k=[r,w6].join("/"), reward=support[6][w7]*p;
      const row=next.get(k)??[0,0,0];
      row[0]+=p; row[1]+=Math.max(reward,sum); row[2]+=reward+sum; next.set(k,row);
    }
    const result=[0,0,0];
    for (const [k,[p,a,b]] of next) {
      const reward=support[5][Number(k.split("/")[1])]*p;
      result[0]+=p; result[1]+=Math.max(reward,a); result[2]+=Math.max(reward+a,b);
    }
    return result.slice(1).map(v=>v/result[0]);
  }
  const ref=[...acquisition(false),...acquisition(true)], actual=table.gate.get(root);
  for(let i=0;i<4;i++) assert.ok(Math.abs(actual[i]-ref[i])<1e-9);
  assert.ok(actual[2]>actual[0]); assert.ok(actual[3]>=actual[1]-1e-9);
});
