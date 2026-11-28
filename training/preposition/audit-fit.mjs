// Independent forward replay of all nine ordered starting states. Each branch
// follows fit 73 on its own feasible menus. Rebuild ridge stationarity and the
// entire action-selection grid without importing the new trainer or ranker.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {FLEET_PAIRS,fleetPairIndex,FLEET_FAMILIES} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureFrames,closureActions} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {switchCostProposal,switchCostDecision,inspectSwitchCost} from "../../docs/lib/switchcost-policy.js";
import {warningFeatures} from "../../docs/lib/preposition-policy.js";
import {weights} from "../addguard/fit.mjs";

const families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
const seeds=[73,101,211],ordered=Array.from({length:9},(_,i)=>[Math.floor(i/3),i%3]);
const dot=(x,w)=>x.reduce((sum,v,i)=>sum+v*w[i],0);
const mean=ys=>ys.reduce((a,b)=>a+b,0)/ys.length;
function visit(start,count,callback) {
  for (const [f,family] of families.entries()) for (let j=0;j<count;j++) {
    const seed=start+count*f+j, frames=closureFrames({family,seed,closure:{starts:[2,3,4,5,6,7,8],durations:[1,2,3,4,4,5,5]}}).map(closureFrame);
    const t=frames.findIndex(f=>f.obs.incident.status==="warning");
    const choices=frames.map(()=>[]),prepared=[];
    function parent(epoch,pos) {
      const k=pos[0]*3+pos[1],board=frames[epoch];
      if (!choices[epoch][k]) {
        const obs={...board.obs,positions:pos},menu=closureActions(obs);
        if (isClosureDecision(obs)) prepared[epoch]??=prepareClosureValues(board,weights.closure);
        const id=switchCostDecision(switchCostProposal(board,menu,weights,prepared[epoch]),weights.parent).chosenId;
        if(j===0) assert.equal(id,inspectSwitchCost(obs,menu,weights.parent,weights).chosenId);
        choices[epoch][k]=menu.find(a=>a.id===id);
      }
      return choices[epoch][k];
    }
    let pos=[0,1];
    for(let epoch=0;epoch<t;epoch++) pos=parent(epoch,pos).positions;
    const menu=closureActions({...frames[t].obs,positions:pos}),baseAction=parent(t,pos);
    const tails=ordered.map(origin=>{
      let positions=origin,net=0,served=0;
      for (let epoch=t+1;epoch<10;epoch++) {
        const a=parent(epoch,positions);
        net+=a.net;served+=a.served;positions=a.positions;
      }
      return [net,served];
    });
    callback({menu,baseAction,features:warningFeatures(frames[t]),tails});
  }
}
function verify(seed) {
  const model=JSON.parse(readFileSync(new URL("../../docs/data/preposition/fit-"+seed+".json",import.meta.url)));
  const start=1200000000+5000000*seeds.indexOf(seed);
  assert.equal(model.format,"fleet-preposition-v1");assert.equal(model.seed,seed);assert.equal(model.parentSeed,73);
  assert.equal(model.parentHash,"b40441315416d9866f032759566f1b8f72bf7280c6ecb57c709a7867f8dfb18c");
  assert.equal(model.trainStart,start);assert.equal(model.selectionStart,start+1000000);assert.equal(model.ridge,.02);
  assert.equal(model.net.length,54);assert.equal(model.service.length,54);
  const gradients=[new Float64Array(54),new Float64Array(54)];
  let weeks=0,branches=0,asymmetric=0;
  visit(start,2048,({menu,features:{x,base},tails})=>{
    weeks++;branches+=menu.length;
    const nets=[],services=[];
    for(const [a,b] of FLEET_PAIRS) {
      const first=tails[a*3+b],second=tails[b*3+a];
      nets.push((first[0]+second[0])/2);services.push((first[1]+second[1])/2);
    }
    if(ordered.some(([a,b])=>tails[a*3+b].some((value,k)=>value!==tails[b*3+a][k]))) asymmetric++;
    const total=mean(nets),service=mean(services);
    for (const [p,row] of x.entries()) {
      const residual=[dot(row,model.net)+base[p]-(nets[p]-total),dot(row,model.service)-(services[p]-service)];
      for (let k=0;k<2;k++) for(let i=0;i<row.length;i++) gradients[k][i]+=residual[k]*row[i];
    }
  });
  assert.deepEqual(model.training,{weeks,rows:weeks*6,legalActionBranches:branches,orderedSuffixes:weeks*9,asymmetricWeeks:asymmetric});
  let maxGradient=0;
  [model.net,model.service].forEach((weights,k)=>weights.forEach((w,i)=>{
    maxGradient=Math.max(maxGradient,Math.abs(gradients[k][i]/(6*weeks)+(i===0 ? 0 : .02*w)));
  }));
  assert(maxGradient<1e-6,"Ridge stationarity residual "+maxGradient);
  const candidates=[0,4,12,24,48].flatMap(serviceCredit=>[0,2,6].map(hurdle=>({
    serviceCredit,hurdle,changed:0,net:0,service:0,moreDelivered:0,fewerDelivered:0,positionChanges:0})));
  let chosenWeeks=0;
  visit(start+1000000,1024,({menu,baseAction,features:{x,base},tails})=>{
    chosenWeeks++;
    const scores=menu.map(a=>{
      const i=fleetPairIndex(a.positions),tail=tails[3*a.positions[0]+a.positions[1]];
      const tailNet=base[i]+dot(x[i],model.net);
      return {a,estimatedNet:a.net+tailNet,estimatedService:a.served+dot(x[i],model.service),
        net:a.net+tail[0],service:a.served+tail[1]};
    });
    const baseline=scores.find(s=>s.a.id===baseAction.id);
    for(const c of candidates) {
      const value=s=>s.estimatedNet+c.serviceCredit*s.estimatedService;
      let best=baseline;
      for(const contender of scores) if(value(contender)>value(best)) best=contender;
      if (value(best)-value(baseline)<=c.hurdle) best=baseline;
      const ds=best.service-baseline.service;
      c.changed+=Number(best.a.id!==baseAction.id);
      c.positionChanges+=Number(fleetPairIndex(best.a.positions)!==fleetPairIndex(baseAction.positions));
      c.net+=best.net-baseline.net;c.service+=ds;
      c.moreDelivered+=Math.max(ds,0);c.fewerDelivered+=Math.max(-ds,0);
    }
  });
  assert.equal(chosenWeeks,model.selection.weeks);assert.deepEqual(candidates,model.selection.candidates);
  const active=candidates.filter(c=>c.changed>0),joint=active.filter(c=>c.net>0 && c.service>0);
  const rank=joint.length ? c=>c.net : c=>Math.min(c.net,34*c.service);
  const selected=(joint.length?joint:active).sort((a,b)=>rank(b)-rank(a)||b.service-a.service)[0];
  assert.equal(model.jointCandidates,joint.length);
  assert.deepEqual(model.settings,{serviceCredit:selected.serviceCredit,hurdle:selected.hurdle});
  console.log("Verified seed",seed,"on",weeks,"training and",chosenWeeks,"selection weeks;",branches,"action branches, max gradient",maxGradient);
}
for(const seed of process.argv[2] ? [Number(process.argv[2])] : seeds) {assert(seeds.includes(seed));verify(seed);}
