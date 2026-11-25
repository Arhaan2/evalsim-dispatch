import test from "node:test";
import assert from "node:assert/strict";
import {createFleetWeek,fleetPairIndex,fleetWeekActions} from "../docs/lib/fleetweek.js";
import {chooseFleetPlanner} from "../docs/lib/fleetweek-planner.js";
import {distinctOverrides,inspectOverride,overrideBelief,overrideContext,overrideExample,selectOverride} from "../docs/lib/override-policy.js";
import {sameFreight} from "../docs/lib/overnight-policy.js";

const settings={blend:1,serviceCredit:12,threshold:2,plannerOnly:false};
test("an override requires the selected advantage to clear its hurdle, and the challenger survives a veto",()=>{
  const alts=[{id:"A",baseline:-2,residual:5,service:0},{id:"B",baseline:-1,residual:0,service:0.25}];
  const selected=selectOverride("R",alts,settings);
  assert.deepEqual(selected,{plannerId:"R",proposalId:"A",chosenId:"A",netGain:3,serviceGain:0,score:3,threshold:2});
  assert.equal(selectOverride("R",alts,{...settings,threshold:3}).chosenId,"R");
  const veto=selectOverride("R",alts,{...settings,plannerOnly:true});
  assert.equal(veto.proposalId,"A");
  assert.equal(veto.chosenId,"R");
  assert.equal(selectOverride("R",[],settings).proposalId,null);
});

test("public duration belief equals exhaustive marginalization over all Monday–Friday center paths",()=>{
  const world=createFleetWeek({family:"steady-market",seed:7});
  for(let i=0;i<3;i++) world.step("W|W");
  const obs=world.observe(),calls=obs.forecast.map(row=>row.indexOf(Math.max(...row)));
  const seen=obs.history.map(f=>f.hub).concat(obs.hub),expected=Array.from({length:10},()=>[0,0,0]);
  const path=[],hazards=[0.16,0.38,0.44,0.36];
  function grow(prior) {
    const t=path.length;
    if(t<10) {
      const current=path[t-1];
      let duration=0;
      for(let k=t-1;k>=0 && path[k]===current;k--) duration++;
      for(const d of [0,1,2]) {
        const change=hazards[Math.min(4,duration)-1];
        const mass=t===0 ? 1/3 : (current===d ? 1-change : change/2);
        path.push(d);grow(prior*mass);path.pop();
      }
      return;
    }
    let mass=prior;
    for(let i=0;i<10;i++) {
      const emitted=(calls[i]===path[i]?0.56:0.08)+0.14*Number(calls[i]===path[Math.max(i-1,0)])+
        0.14*Number(calls[i]===path[Math.min(i+1,9)]);
      const realized=i>=seen.length?1:0.11/3+(i===0?0.89:0.68)*Number(seen[i]===path[i])+
        (i>0?0.21*Number(seen[i-1]===seen[i]):0);
      mass*=emitted*realized;
    }
    for(let i=0;i<10;i++) expected[i][path[i]]+=mass;
  }
  grow(1);
  const posterior=overrideBelief(obs);
  expected.forEach((row,t)=>{
    const total=row.reduce((a,b)=>a+b);
    row.forEach((v,d)=>assert.ok(Math.abs(v/total-posterior[t][d])<1e-9));
  });
});

test("every suggestion retains the planner's signed freight and changes the ending placement",()=>{
  const world=createFleetWeek({family:"late-transfer",seed:92});
  const model={net:Array(55).fill(0),service:Array(55).fill(0),settings};
  let eligible=0;
  while(!world.done) {
    const obs=world.observe();
    for(const positions of [[0,0],[0,1],[1,2],[2,0]]) {
      const publicBoard={...obs,positions};
      const menu=fleetWeekActions(publicBoard),id=chooseFleetPlanner(publicBoard,menu);
      const ref=menu.find(a=>a.id===id),details=inspectOverride(publicBoard,menu,model);
      assert.equal(details.plannerId,id);
      assert.equal(details.chosenId,id);
      if(![1,3,5,7].includes(obs.epoch)) {assert.equal(details.proposalId,null);continue;}
      const alternatives=distinctOverrides(menu,ref);
      assert.equal(new Set(alternatives.map(a=>fleetPairIndex(a.positions))).size,alternatives.length);
      for(const a of alternatives) {
        assert.ok(sameFreight(a,ref));
        assert.notEqual(fleetPairIndex(a.positions),fleetPairIndex(ref.positions));
        assert.equal(overrideExample(overrideContext(obs),ref,a).features.length,model.net.length);
      }
      if(alternatives.length) {
        eligible++;
        const masked={epoch:obs.epoch,forecast:obs.forecast,history:obs.history,hub:obs.hub};
        assert.deepEqual(inspectOverride(masked,menu,model),details);
      }
    }
    world.step("W|W");
  }
  assert.ok(eligible>0);
});
