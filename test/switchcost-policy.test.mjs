import test from "node:test";
import assert from "node:assert/strict";
import {chooseSwitchCost,switchCostDecision,switchCostEstimates} from "../docs/lib/switchcost-policy.js";
import {chooseCandidate} from "../training/switchcost/fit.mjs";

const p={eligible:true,rescueEligible:true,shortId:"S",longId:"L",previousId:"S",recallId:"L",recallAccepted:true};
const s={vetoFraction:.15,addFraction:.15,vetoBelow:-2,addAbove:2};
const est=net=>({winProbability:0,lossProbability:0,expectedNet:net,expectedUpside:Math.max(0,net),
  expectedDownside:Math.max(0,-net),expectedService:0});
test("the two-sided rule vetoes and adds on separate groups, preserving ties and disabled sides",()=>{
  assert.equal(chooseSwitchCost(p,est(-3),s).chosenId,"S");
  assert.equal(chooseSwitchCost(p,est(-2),s).chosenId,"L");
  assert.equal(chooseSwitchCost(p,est(-30),{...s,vetoFraction:0}).chosenId,"L");
  const miss={...p,recallId:"S",recallAccepted:false};
  assert.equal(chooseSwitchCost(miss,est(3),s).added,true);
  assert.equal(chooseSwitchCost(miss,est(2),s).chosenId,"S");
  assert.equal(chooseSwitchCost(miss,est(30),{...s,addFraction:0}).chosenId,"S");
});
test("original long approvals survive both conditional and flat controls",()=>{
  const locked={...p,previousId:"L",recallAccepted:false,rescueEligible:false,recallEstimate:est(-500)};
  for (const flatGate of [true,false]) {
    const d=switchCostDecision(locked,{settings:s},{flatGate});
    assert.equal(d.chosenId,"L");assert.equal(d.lossProbability,null);assert.equal(d.vetoed,false);assert.equal(d.added,false);
  }
});
test("excluded ties leave probability mass and severe overpredictions share one unit",()=>{
  const means={loss:.7,win:.8,downside:3,upside:2,service:.1};
  const calibration=Object.fromEntries(Object.entries(means).map(([k,mean])=>[k,{mean}]));
  const e=switchCostEstimates(p,{calibration},{flatGate:true});
  assert.equal(e.lossProbability,.7/1.5);assert.equal(e.winProbability,.8/1.5);assert.equal(e.expectedNet,-1);
  calibration.loss.mean=.1;
  assert(switchCostEstimates(p,{calibration},{flatGate:true}).winProbability+calibration.loss.mean<1);
});
test("positive veto savings, replacement wins, total loss reduction, service and profit all gate selection",()=>{
  const zero={settings:{id:0},vetoedLosses:0,addedLosses:0,addedWins:0,vetoedWins:0,vetoSavings:0,
    serviceRecall:{mean:0},serviceShort:{mean:0},netRecall:{mean:0},netShort:{lowerSE:0}};
  const good={...zero,settings:{id:1},vetoedLosses:4,addedLosses:2,addedWins:1,vetoedWins:1,vetoSavings:3,netRecall:{mean:.5},netShort:{lowerSE:.01}};
  for(const patch of [{addedLosses:4},{addedWins:0},{vetoSavings:0},{serviceRecall:{mean:-.01}},
    {serviceShort:{mean:-.01}},{netRecall:{mean:0}},{netShort:{lowerSE:0}}]) {
    assert.deepEqual(chooseCandidate([zero,{...good,...patch}]),{settings:zero.settings,feasible:0});
  }
  assert.deepEqual(chooseCandidate([zero,good]),{settings:good.settings,feasible:1});
});
