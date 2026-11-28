import assert from "node:assert/strict";
import test from "node:test";
import {closureActions,closureFrames} from "../docs/lib/closure-world.js";
import {closureFrame} from "../docs/lib/closure-planner.js";
import {warningFeatures,choosePosition,prepositionProposal,decisionFromProposal} from "../docs/lib/preposition-policy.js";
import {centeredTargets,selectCandidate,weights} from "../training/preposition/fit.mjs";

test("all legal warning choices compete, ties keep fit 73 and the hurdle is strict",()=>{
  const scores=[{id:"alternative",net:5,service:1},{id:"parent",net:7,service:0},{id:"third",net:6,service:1}];
  assert.equal(choosePosition(scores,"parent",{serviceCredit:0,hurdle:0}).chosenId,"parent");
  assert.equal(choosePosition(scores,"parent",{serviceCredit:2,hurdle:0}).chosenId,"third");
  assert.equal(choosePosition(scores,"parent",{serviceCredit:2,hurdle:1}).chosenId,"parent");
  assert.equal(choosePosition(scores,"parent",{serviceCredit:1,hurdle:0}).chosenId,"parent");
  assert.deepEqual(choosePosition(scores,"parent",{serviceCredit:2,hurdle:0}),
    {chosenId:"third",predictedNetGain:-1,predictedServiceGain:1});
});

test("both truck orderings contribute to a physical placement; each placement has equal weight",()=>{
  const ordered=Array.from({length:9},(_,i)=>({net:i,service:2*i}));
  const y=centeredTargets(ordered);
  assert.deepEqual(y.map(a=>a[0]),[-4,-2,0,0,2,4]);
  assert.deepEqual(y.map(a=>a[1]),[-8,-4,0,0,4,8]);
});

test("only the public warning activates the six centered placement values",()=>{
  const frames=closureFrames({seed:18001,family:"eastbound",closure:{starts:[4],durations:[3]}}).map(closureFrame);
  for (const frame of frames) {
    const p=prepositionProposal(frame,closureActions(frame.obs),weights);
    if (!p.warning) {
      assert.equal(p.features,null);
      assert.equal(decisionFromProposal(p,null).chosenId,p.parentId);
    } else {
      const {x,base}=warningFeatures(frame);
      assert.equal(x.length,6);assert.equal(x[0].length,54);assert.equal(base.length,6);
      assert(x.flat().every(Number.isFinite));assert(x.every(f=>f[0]===1));
      for(let j=1;j<54;j++) assert(Math.abs(x.reduce((s,f)=>s+f[j],0))<1e-9);
    }
  }
});

test("selection prefers a joint improvement and deterministically exposes a real fallback",()=>{
  const entry=(serviceCredit,net,service,changed=3)=>({serviceCredit,hurdle:0,net,service,changed});
  let picked=selectCandidate([entry(0,100,-1),entry(4,5,1),entry(12,5,2)]);
  assert.equal(picked.settings.serviceCredit,12);assert.equal(picked.jointCandidates,2);
  picked=selectCandidate([entry(0,0,0,0),entry(4,35,-1),entry(12,-2,3)]);
  assert.equal(picked.settings.serviceCredit,12);assert.equal(picked.jointCandidates,0);
});
