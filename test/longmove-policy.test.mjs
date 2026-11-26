import test from "node:test";
import assert from "node:assert/strict";
import {closureActions,closureFrames} from "../docs/lib/closure-world.js";
import {closureFrame} from "../docs/lib/closure-planner.js";
import {shortDefaultProposal} from "../docs/lib/shortdefault-policy.js";
import {chooseLongMove,headNames,longMoveDecision,longMoveProposal,rawHead} from "../docs/lib/longmove-policy.js";
import {weights} from "../training/shortdefault/fit.mjs";
import {tapeExamples} from "../training/longmove/fit.mjs";

test("the nonlinear gate exposes win probabilities even when economics or selection favors short",()=>{
  const p={eligible:true,shortId:"S",longId:"L",x:[1,2]};
  const heads=Object.fromEntries(headNames.map(k=>[k,{base:0,rate:1,trees:[{value:0}]}]));
  heads.win.trees=[{feature:1,cut:1,left:{value:.1},right:{value:.8}}];
  const means=[.4,2,5,.1];
  const calibration=Object.fromEntries(headNames.map((k,i)=>[k,{mean:means[i],slope:k==="win" ? 1 : 0,predictedMean:k==="win" ? .4 : 0}]));
  const settings={shortOnly:false,minWin:.55,hurdle:0,serviceCredit:12},model={heads,calibration,settings};
  const pass=longMoveDecision(p,model);
  assert.equal(pass.winProbability,.8);assert.equal(pass.chosenId,"L");assert(Math.abs(pass.expectedNet-.6)<1e-10);
  assert.equal(longMoveDecision({...p,x:[1,0]},model).chosenId,"S");
  assert.equal(longMoveDecision(p,model,{flatGate:true}).chosenId,"S");
  const frozen=longMoveDecision(p,{...model,settings:{...settings,shortOnly:true}});
  assert.equal(frozen.chosenId,"S");assert.equal(frozen.winProbability,.8);
  assert.equal(longMoveDecision({...p,eligible:false,x:null},model).winProbability,null);
  assert.equal(chooseLongMove(p,{winProbability:.8,expectedNet:0,expectedService:.1},settings).chosenId,"S");
  assert.equal(rawHead(heads.win,[1,1]),.1);
});

test("training includes actual ordered path and canonical counterfactuals once with the specified weights",()=>{
  let onPath=0,offPath=0,reversed=0;
  for (const [family,seed] of [["split-return",7],["midweek-return",5],["long-home-market",19]]) {
    const frames=closureFrames({family,seed,closure:{starts:[2,4,6],durations:[1,2,3,4,5]}}).map(closureFrame);
    let pos=[0,1];const encountered=[];
    for (const frame of frames) {
      encountered.push(3*pos[0]+pos[1]);
      const menu=closureActions({...frame.obs,positions:pos});
      const id=shortDefaultProposal(frame,menu,weights).shortId;pos=menu.find(a=>a.id===id).positions;
    }
    const emitted=new Set();
    tapeExamples(frames,(row,t,i)=>{
      assert(!emitted.has(9*t+i));emitted.add(9*t+i);
      const pos=[Math.floor(i/3),i%3],on=encountered[t]===i;
      assert.equal(row.onPath,on);assert.equal(row.weight,Number(pos[0]<=pos[1])+8*Number(on));
      if (on) onPath++;else offPath++;
      if (pos[0]>pos[1]) {assert(on);reversed++;}
      const f=frames[t],menu=closureActions({...f.obs,positions:pos});
      const p=longMoveProposal(f,menu,weights);
      assert.deepEqual(row.x,p.x);assert.equal(row.x.length,55);
      const [sc,se,lc,le,dc,de]=p.x.slice(-6);
      assert(sc>=-1e-10 && sc<=1+1e-10 && lc>=-1e-10 && lc<=1+1e-10);
      assert.equal(dc,lc-sc);assert.equal(de,le-se);
    });
  }
  assert(onPath>0 && offPath>0 && reversed>0);
});
