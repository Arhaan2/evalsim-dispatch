import assert from "node:assert/strict";
import test from "node:test";
import {fitBoard} from "../training/loadchoice/fit.mjs";
import {boardKey,gateKey,sixKey,sevenKey,waitValues} from "../docs/lib/lastslot-policy.js";
import {loadchoiceDecision} from "../docs/lib/loadchoice-policy.js";

// Equal numbers of cold and hot tapes. At seven, a purchased zero reading
// favors taking the current signed offer; six favors waiting for the last load.
const prices=[[2,10],[2,12],[2,22]];
const gate=gateKey(5,0);
const history=Array.from({length:5},()=>({high:false,quote:{low:9,high:18,highChance:0.5}}));
function example() {
  const n=288*288,data={count:new Float64Array(n),reward:new Float64Array(n)};
  for(const r of [0,6]) {
    const k=gate*288+sevenKey(sixKey(r,false),5,true);
    data.count[k]=1000;data.reward[k]=r===0 ? 0 : 1000;
  }
  const rows=fitBoard(data,data,data,prices,16);
  return {rows,model:{opening:"tariff",boards:{[boardKey(history[0].quote)]:rows}}};
}
test("realized return fitting uses a measured zero to book and a high reading to wait for a better load",()=>{
  const {rows,model}=example(),row=rows[gate],q=waitValues(row);
  assert.equal(q[16+sevenKey(sixKey(0,false),5,true)],2);
  assert.equal(q[16+sevenKey(sixKey(6,false),5,true)],22);
  assert.equal(q[16+sevenKey(sixKey(-1,false),5,true)],12);
  assert.equal(row.skip,12);
  assert.equal(row.delta,5);
  const o={phase:"freight",slots:1,wave:6,history:[...history,{...history[0]}],quote:{high:12,highChance:0.5},offer:{net:12}};
  assert.equal(loadchoiceDecision({...o,reading:0},model,{}).action,"accept");
  assert.equal(loadchoiceDecision({...o,reading:6},model,{}).action,"pass");
  assert.equal(loadchoiceDecision({...o,reading:null},model,{}).action,"accept");
});
test("the acquisition call reads only the completed public prefix and fee, and a tie goes to skipping",()=>{
  const {model}=example(),o={phase:"survey",slots:1,wave:5,history,surveyFee:5,quote:{low:2,high:10}};
  for(const key of ["reading","offer","seed","family","trueHighChances"]) Object.defineProperty(o,key,{get(){throw Error("Gate accessed "+key);}});
  assert.equal(loadchoiceDecision(o,model,{}).action,"skip");
  assert.equal(loadchoiceDecision(o,model,{},"always").action,"buy");
  o.surveyFee=.75;
  assert.equal(loadchoiceDecision(o,model,{}).action,"buy");
  assert.equal(loadchoiceDecision(o,model,{},"never").action,"skip");
  o.slots=2;assert.equal(loadchoiceDecision(o,model,{},"always").action,"skip");
});
