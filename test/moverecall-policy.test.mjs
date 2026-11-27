import test from "node:test";
import assert from "node:assert/strict";
import {chooseMoveRecall,moveRecallDecision,neighborPrediction,quantize} from "../docs/lib/moverecall-policy.js";
import {closureFrame} from "../docs/lib/closure-planner.js";
import {closureActions,closureFrames} from "../docs/lib/closure-world.js";
import {longMoveProposal,longMoveDecision} from "../docs/lib/longmove-policy.js";
import {replay,weights} from "../training/moverecall/fit.mjs";

test("64 neighbors break equal distances by archived order and shrink to 16 prior cases",()=>{
  const cases=Array.from({length:70},(_,i)=>({x:[0,0],net:i<64 ? 1 : -9,service:1}));
  const model={metric:[1,1],cases,means:{win:0,net:0,downside:0,service:0}};
  assert.deepEqual(neighborPrediction([0,1],model),[.8,.8,0,.8]);
  assert.deepEqual(quantize([200,-200,-.001],{center:[0,0,0],scale:[1,1,1]}),[128,-128,0]);
});
test("the release and flat control retain every previous long",()=>{
  const settings={priorOnly:true,minWin:.5,hurdle:100,lossPenalty:.1};
  const p={eligible:true,rescueEligible:false,shortId:"S",longId:"L",previousId:"L",
    previous:{winProbability:.8,expectedNet:9,lossIfNonwin:4,expectedService:0}};
  for (const flatGate of [true,false]) {
    const d=moveRecallDecision(p,{settings},{flatGate});
    assert.equal(d.chosenId,"L");assert.equal(d.rescued,false);assert.equal(d.winProbability,.8);
  }
  const skip={...p,rescueEligible:true,previousId:"S"};
  const est={expectedNet:4,expectedDownside:10,expectedService:0,winProbability:.5};
  assert.equal(chooseMoveRecall(skip,est,settings).chosenId,"S");
  assert.equal(chooseMoveRecall(skip,est,{...settings,priorOnly:false,hurdle:3}).chosenId,"S");
  assert.equal(chooseMoveRecall(skip,est,{...settings,priorOnly:false,hurdle:2}).chosenId,"L");
});
test("training samples only encountered old skips and uses short-policy tails on both branches",()=>{
  let samples=0;
  for (const [family,seed] of [["split-return",7],["midweek-return",5],["long-home-market",19]]) {
    const frames=closureFrames({family,seed,closure:{starts:[2,4,6],durations:[1,2,3,4,5]}}).map(closureFrame);
    const {skipped}=replay(frames);
    const independent=(t,pos)=>{
      const f=frames[t],menu=closureActions({...f.obs,positions:pos}),p=longMoveProposal(f,menu,weights);
      return {prior:longMoveDecision(p,weights.previous),s:menu.find(a=>a.id===p.shortId),l:menu.find(a=>a.id===p.longId)};
    };
    const friday=(t,a)=>{
      let net=a.net,service=a.served,pos=a.positions;
      for (let k=t+1;k<10;k++) {const {s}=independent(k,pos);net+=s.net;service+=s.served;pos=s.positions;}
      return [net,service];
    };
    let pos=[0,1],count=0;
    for (let t=0;t<10;t++) {
      const {prior,s,l}=independent(t,pos);
      if (s.id!==l.id && prior.chosenId===s.id) {
        const e=skipped[count++];assert.equal(e.t,t);assert.deepEqual(e.pos,pos);
        const a=friday(t,s),b=friday(t,l);assert.deepEqual([e.net,e.service],[b[0]-a[0],b[1]-a[1]]);
      }
      pos=s.positions;
    }
    assert.equal(count,skipped.length);samples+=count;
  }
  assert(samples>0);
});
