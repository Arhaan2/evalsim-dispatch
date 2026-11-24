import assert from "node:assert/strict";
import test from "node:test";
import { fitBoard } from "../training/waitcost/fit.mjs";
import { packWait, gateKey, sixKey, sevenKey } from "../docs/lib/lastslot-policy.js";
import { waitcostDecision } from "../docs/lib/waitcost-policy.js";

const gate=gateKey(5,0),prices=[[2,10],[2,12],[2,22]];
const history=Array.from({length:5},()=>({high:false,quote:{low:9,high:18,highChance:0.5}}));
const priors={};
const q=new Float64Array(304);
const low=sixKey(0,true),high=sixKey(6,true);
q[low]=13;q[high]=13;q[1]=9;
const atSeven=sevenKey(low,5,true);
q[16+atSeven]=15;q[16+sevenKey(low,5,false)]=16;
const old={skip:10,delta:0.2,wait:packWait(q)};
priors.loadchoice={opening:"tariff",boards:{"9/18":Array(288).fill(old)}};

function fit() {
  const t=(j,n,hi)=>({gate,j,n,high:hi});
  // The sixth-wave high offer pays ten. A measured zero usually has poor
  // later offers here; a high reading has a twelve-credit seventh load.
  const seven=[t(atSeven,20000,10000)];
  const sim=[t(sevenKey(low,5,false),10000,0),t(sevenKey(high,5,true),10000,0)];
  return {opening:"tariff",penalty:0.5,boards:{"9/18":fitBoard(seven,sim,sim,priors.loadchoice.boards["9/18"],prices,0.5)}};
}
const model=fit();
const sixth={phase:"freight",slots:1,wave:5,history,quote:{high:10},offer:{net:10}};
test("paid risky deferrals trigger a paired booking correction; safe waits and blind bookings survive",()=>{
  const bad=waitcostDecision({...sixth,reading:0},model,priors);
  assert.equal(bad.action,"accept");assert.equal(bad.guard.reverted,true);
  assert(bad.guard.meanWaitGain < -7.9);assert(bad.guard.lossProbability > .99);
  const good=waitcostDecision({...sixth,reading:6},model,priors);
  assert.equal(good.action,"pass");assert(good.guard.meanWaitGain>1.9);
  const skip=waitcostDecision({...sixth,reading:null},model,priors);
  assert.equal(skip.action,"accept");assert.equal(skip.guard,null);
  const seven={...sixth,wave:6,history:[...history,{high:true}],reading:0,quote:{high:12,highChance:.5},offer:{net:12}};
  const risk=waitcostDecision(seven,model,priors).guard;
  assert.equal(risk.meanWaitGain,0);assert.equal(risk.meanDownside,5);
  assert.equal(risk.lossProbability,.5);assert.equal(risk.score,-2.5);
  assert.equal(risk.reverted,true);
});
test("the purchase value prices the corrected freight without reading tomorrow's offer or the ending",()=>{
  const gateObs={phase:"survey",slots:1,wave:5,history,surveyFee:.5};
  for(const key of ["reading","offer","family","seed","trueHighChances"]) Object.defineProperty(gateObs,key,{get(){throw Error("Forbidden gate input: "+key);}});
  const decision=waitcostDecision(gateObs,model,priors);
  assert.equal(decision.action,"buy");
  assert.equal(model.boards["9/18"][gate].delta,1);
  assert.equal(waitcostDecision({...gateObs,surveyFee:1},model,priors).action,"skip");
  assert.equal(waitcostDecision(gateObs,model,priors,"never").action,"skip");
  assert.equal(waitcostDecision({...gateObs,slots:2},model,priors,"always").action,"skip");
});
