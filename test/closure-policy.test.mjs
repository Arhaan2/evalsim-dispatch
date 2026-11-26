import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {closureActions,closureFrames} from "../docs/lib/closure-world.js";
import {closureFrame,flatRiskOnFrame} from "../docs/lib/closure-planner.js";
import {closureChoices,closureFeatures,inspectClosure,selectClosure} from "../docs/lib/closure-policy.js";
import {sameFreight} from "../docs/lib/overnight-policy.js";

const historical=Object.fromEntries(["override","uncertainty"].map(key=>[key,JSON.parse(readFileSync(
  new URL("../docs/data/"+key+"/model-13.json",import.meta.url)))]));
const settings={blend:0.5,serviceCredit:12,hurdle:2,constantOnly:false};
test("the closure policy retains the incumbent on a tie with its switching hurdle",()=>{
  const choices={plannerId:"P",constant:{id:"C"}};
  const alt={action:{id:"A"},base:-2,correction:4,service:1/6};
  const tied=selectClosure(choices,[alt],settings);
  assert.equal(tied.chosenId,"C");
  assert.equal(tied.proposalId,"A");
  assert.equal(tied.expectedService,0);
  const great={...alt,service:.5};
  const switched=selectClosure(choices,[great],settings);
  assert.equal(switched.chosenId,"A");
  assert.equal(switched.proposalNet,0);
  assert.equal(switched.expectedService,.5);
  assert.equal(selectClosure(choices,[great],{...settings,constantOnly:true}).chosenId,"C");
});
test("an unrevealed repair and a reopened depot use exactly the published incumbent",()=>{
  const frames=closureFrames({family:"steady-market",seed:7,closure:{starts:[3],durations:[2]}});
  for (const obs of [frames[0],frames[1],frames[5],frames[9]]) {
    const menu=closureActions(obs), f=closureFrame(obs);
    const detail=inspectClosure(obs,menu,{settings},historical);
    assert.equal(detail.proposalId,null);
    assert.equal(detail.chosenId,flatRiskOnFrame(f,menu,historical));
  }
});
test("closure value features use public evidence and alternatives preserve both signed loads",()=>{
  const all=closureFrames({family:"steady-market",seed:7,closure:{starts:[3],durations:[2]}});
  const frame=closureFrame(all[2]), features=closureFeatures(frame);
  assert.equal(features.x.length,6);
  for (let j=1;j<features.x[0].length;j++) assert(Math.abs(features.x.reduce((s,row)=>s+row[j],0))<1e-10);
  assert.deepEqual(closureFeatures(closureFrame(structuredClone(all[2]))),features);
  let n=0;
  for (const obs of all.slice(2,5)) {
    const f=closureFrame(obs);
    for (const a of [0,1,2]) for (const b of [0,1,2]) {
      const c=closureChoices(f,closureActions({...obs,positions:[a,b]}),historical);
      for (const move of c.alternatives) {assert(sameFreight(move,c.constant));n++;}
    }
  }
  assert(n>0);
});
