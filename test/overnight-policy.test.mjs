import test from "node:test";
import assert from "node:assert/strict";
import { createFleetWeek,FLEET_PAIRS,fleetWeekActions } from "../docs/lib/fleetweek.js";
import { chooseFleetPlanner, fleetPlannerContinuation } from "../docs/lib/fleetweek-planner.js";
import { chooseOvernight,isOvernight,overnightFeatures,rankOvernight,sameFreight } from "../docs/lib/overnight-policy.js";
import { pairedFridayReturns } from "../training/overnight/fit.mjs";

function signedFixture() {
  const w=createFleetWeek({family:"steady-market",seed:12}), frames=[];
  while (!w.done) {
    const obs=w.observe();
    frames.push({obs,base:fleetPlannerContinuation(obs)});
    w.step("W|W");
  }
  return frames;
}

test("paired targets agree with direct planner rollouts after every overnight placement",()=>{
  const frames=signedFixture(), targets=pairedFridayReturns(frames);
  for (const [j,target] of targets.entries()) for (const [p,start] of FLEET_PAIRS.entries()) {
    let positions=start, net=0, served=0;
    for (let t=2*j+2; t<10; t++) {
      const obs={...frames[t].obs,positions}, legal=fleetWeekActions(obs);
      const id=chooseFleetPlanner(obs,legal), a=legal.find(action=>action.id===id);
      net+=a.net;served+=a.served;positions=a.positions;
    }
    assert.equal(net,target.net[p]);
    assert.equal(served,target.service[p]);
  }
});

test("policy improvement adds or cancels empty trips while preserving each signed job",()=>{
  const actions=[
    {id:"C|W",moves:["C","W"],net:30,positions:[1,0]},
    {id:"C|E2",moves:["C","E2"],net:16,positions:[1,2]},
    {id:"S0|E2",moves:["S0","E2"],net:700,positions:[1,2]},
  ];
  const menu=actions, base=[0,0,0,0,0,0];
  const heads={residual:[0,0,0,0,20,0],service:[0,0,0,0,-1,0]};
  const settings={blend:1,serviceCredit:0,minimumGain:0};
  assert.equal(rankOvernight(menu,menu[0],base,heads,settings),"C|E2");
  assert.equal(rankOvernight(menu,menu[1],base,heads,{...settings,serviceCredit:10}),"C|W");
  assert.equal(rankOvernight(menu,menu[0],base,heads,{...settings,minimumGain:6}),"C|W");
  assert.equal(sameFreight(menu[0],menu[2]),false);
});

test("only the four overnight decision windows use learned heads; identity scoring reproduces the planner",()=>{
  const frames=signedFixture();
  const dimension=overnightFeatures(frames[1].obs,frames[1].base).length;
  const rows=()=>FLEET_PAIRS.map(()=>new Array(dimension).fill(0));
  const checkpoint={nights:Array.from({length:4},()=>({net:rows(),service:rows()})),
    settings:{blend:1,serviceCredit:30,minimumGain:0}};
  for (const {obs} of frames) for (const pair of FLEET_PAIRS) {
    const o={...obs,positions:pair}, menu=fleetWeekActions(o);
    assert.equal(chooseOvernight(o,menu,isOvernight(o.epoch)?checkpoint:null),chooseFleetPlanner(o,menu));
  }
  const obs=frames[1].obs;
  const features=overnightFeatures(obs,frames[1].base);
  assert.deepEqual(features,overnightFeatures({...obs,seed:56,family:"not visible",futureOrders:[{revenue:999}]},frames[1].base));
});
