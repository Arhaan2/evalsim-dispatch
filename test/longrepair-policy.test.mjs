import test from "node:test";
import assert from "node:assert/strict";
import {closureFrames,closureActions} from "../docs/lib/closure-world.js";
import {closureFrame} from "../docs/lib/closure-planner.js";
import {inspectClosure} from "../docs/lib/closure-policy.js";
import {sameFreight} from "../docs/lib/overnight-policy.js";
import {chooseLongRepair,gateAdvantage,longRepairProposal} from "../docs/lib/longrepair-policy.js";
import {historical} from "../training/longrepair/fit.mjs";

test("the long-repair gate charges its hurdle and only accepts the frozen proposal",()=>{
  const proposal={eligible:true,plannerId:"P",constantId:"C",closureId:"R"};
  const settings={serviceCredit:12,hurdle:5,constantOnly:false};
  assert.equal(chooseLongRepair(proposal,[2,0.25],settings).chosenId,"C");
  assert.equal(chooseLongRepair(proposal,[2.01,0.25],settings).chosenId,"R");
  assert.equal(chooseLongRepair(proposal,[2.01,0.25],{...settings,constantOnly:true}).chosenId,"C");
  assert.equal(chooseLongRepair({...proposal,eligible:false},[100,1],settings).chosenId,"C");
});

test("the flat gate uses the mean of each paired response",()=>{
  const calibration={net:{mean:-1,slope:0.5,predictedMean:3},service:{mean:0.25,slope:1,predictedMean:1}};
  const model={calibration,net:[2,1],service:[1,-1],center:[0,10],scale:[1,2]};
  const p={eligible:true,x:[1,14],priorNet:3,priorService:0.25};
  assert.deepEqual(gateAdvantage(p,model),[1,-1.5]);
  assert.deepEqual(gateAdvantage(p,model,{flatGate:true}),[-1,0.25]);
  assert.deepEqual(gateAdvantage({...p,eligible:false},model,{flatGate:true}),[0,0]);
});

test("every gate opportunity reproduces the frozen action using public observations",()=>{
  let eligible=0;
  for (let seed=0;seed<15;seed++) {
    const frames=closureFrames({family:"steady-market",seed,closure:{starts:[2],durations:[5]}});
    for (const obs of frames) for (const positions of [[0,1],[2,1],[0,0]]) {
      const visible=structuredClone({...obs,positions}), menu=closureActions(visible);
      const prior=inspectClosure(visible,menu,historical.closure,historical);
      const p=longRepairProposal(closureFrame(visible),menu,historical);
      assert.equal(p.closureId,prior.chosenId);
      assert.equal(p.constantId,prior.constantId);
      assert.equal(p.eligible,prior.chosenId!==prior.constantId);
      if (p.eligible) {
        assert(["warning","closed"].includes(obs.incident.status));
        assert(p.x.every(Number.isFinite));
        assert(sameFreight(menu.find(a=>a.id===p.closureId),menu.find(a=>a.id===p.constantId)));
        eligible++;
      } else assert.equal(p.x,null);
    }
  }
  assert(eligible>0);
});
