import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFleetWeek, FLEET_FAMILIES, FLEET_PAIRS, fleetPairIndex, fleetWeekActions } from "../../docs/lib/fleetweek.js";
import { OVERRIDE_TRAIN_FAMILIES } from "../../docs/lib/override-markets.js";
import { bestFleetAction, fleetPlannerContinuation } from "../../docs/lib/fleetweek-planner.js";
import { overrideContext, overrideExample } from "../../docs/lib/override-policy.js";

const root=new URL("../../docs/data/override/",import.meta.url);
const families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
const seeds=[13,37,73,101,211];
const isNight=t=>[1,3,5,7].includes(t);
const rounded=n=>Number(n.toFixed(8));
const dot=(w,x)=>x.reduce((sum,n,i)=>sum+n*w[i],0);
function makeFrames(config) {
  const world=createFleetWeek(config), frames=[];
  while (!world.done) {
    const obs=world.observe(),base=fleetPlannerContinuation(obs);
    frames.push({obs,base,context:isNight(obs.epoch) ? overrideContext(obs,base):null,boards:[],offers:[]});
    world.step("W|W");
  }
  return frames;
}
function board(frame,pos) {
  const index=3*pos[0]+pos[1];
  if(frame.boards[index]) return frame.boards[index];
  const menu=fleetWeekActions({...frame.obs,positions:pos});
  const id=bestFleetAction(menu,frame.base);
  return frame.boards[index]={menu,ref:menu.find(action=>action.id===id)};
}
function legalChallengers(menu,ref) {
  const groups=new Map();
  for(const action of menu) {
    const preserved=action.moves.every((code,i)=>code===ref.moves[i] ||
      (/^(W|E[0-2])$/.test(code) && /^(W|E[0-2])$/.test(ref.moves[i])));
    if(!preserved) continue;
    const key=fleetPairIndex(action.positions);
    if(key===fleetPairIndex(ref.positions)) continue;
    const prior=groups.get(key);
    if(!prior || prior.net<action.net) groups.set(key,action);
  }
  return [...groups.values()];
}

// Forward execution from the actual ordered landing positions provides a
// different calculation from the fitter's backward nine-state recursion.
function finish(frames,t,action) {
  let net=action.net,served=action.served,positions=action.positions;
  for(let k=t+1;k<frames.length;k++) {
    const {ref}=board(frames[k],positions);
    net+=ref.net;served+=ref.served;positions=ref.positions;
  }
  return {net,served};
}
function checkFit(model) {
  const gradients=[new Float64Array(model.features),new Float64Array(model.features)];
  const byNight=[0,0,0,0];
  for(const [i,family] of families.entries()) {
    for(let k=0;k<768;k++) {
      const frames=makeFrames({family,seed:model.trainStart+i*768+k});
      for(const t of [1,3,5,7]) {
        for(const positions of FLEET_PAIRS) {
          const frame=frames[t],{menu,ref}=board(frame,positions);
          const baseline=finish(frames,t,ref);
          for(const alt of legalChallengers(menu,ref)) {
            const outcome=finish(frames,t,alt);
            const {features:x,baseline:gap}=overrideExample(frame.context,ref,alt);
            const residual=outcome.net-baseline.net-gap-dot(model.net,x);
            const service=outcome.served-baseline.served-dot(model.service,x);
            for(let j=0;j<x.length;j++) {
              gradients[0][j]+=x[j]*residual;
              gradients[1][j]+=x[j]*service;
            }
            byNight[(t-1)/2]++;
          }
        }
      }
    }
  }
  const count=byNight.reduce((a,b)=>a+b,0);
  assert.equal(model.examples,count);
  assert.deepEqual(model.byNight,byNight);
  let worst=0;
  for(const [head,weights] of [model.net,model.service].entries()) {
    for(let j=0;j<weights.length;j++) {
      const error=gradients[head][j]/count-(j===0?0:0.002*weights[j]);
      worst=Math.max(worst,Math.abs(error));
    }
  }
  assert.ok(worst<0.000001,"Fitted model violates the ridge normal equations: "+worst);
  return {count,worst};
}
function options() {
  const result=[{blend:1,serviceCredit:0,threshold:0,plannerOnly:true}];
  for(const blend of [0.5,1]) for(const serviceCredit of [0,12,30]) for(const threshold of [0,2,5]) {
    result.push({blend,serviceCredit,threshold,plannerOnly:false});
  }
  return result;
}
function rollout(frames,model,option) {
  let positions=[0,1],net=0,served=0,changed=0;
  for(const frame of frames) {
    const {ref,menu}=board(frame,positions);
    let action=ref;
    if(frame.context && !option.plannerOnly) {
      const index=3*positions[0]+positions[1];
      const estimates=frame.offers[index] ??= legalChallengers(menu,ref).map(alt=>{
        const e=overrideExample(frame.context,ref,alt);
        return {alt,baseline:e.baseline,net:dot(model.net,e.features),service:dot(model.service,e.features)};
      });
      let score=option.threshold;
      for(const e of estimates) {
        const q=e.baseline+option.blend*e.net+option.serviceCredit*e.service;
        if(q>score) {score=q;action=e.alt;}
      }
    }
    net+=action.net;served+=action.served;changed+=Number(action.id!==ref.id);
    positions=action.positions;
  }
  return {net,served,changed};
}
function checkSelection(model) {
  const grid=options(), sums=grid.map(()=>({gain:0,gain2:0,service:0,service2:0,changes:0}));
  let n=0;
  for(const [i,family] of families.entries()) for(let k=0;k<384;k++) {
    const frames=makeFrames({family,seed:model.selectStart+384*i+k});
    const planner=rollout(frames,model,grid[0]);
    grid.forEach((settings,index)=>{
      const row=index===0 ? planner : rollout(frames,model,settings),s=sums[index];
      const net=row.net-planner.net,service=row.served-planner.served;
      s.gain+=net;s.gain2+=net*net;s.service+=service;s.service2+=service*service;s.changes+=row.changed;
    });
    n++;
  }
  function lower(sum,squares) {
    const sd=Math.sqrt(Math.max(0,(squares-sum*sum/n)/(n-1)));
    return rounded(sum/n-sd/Math.sqrt(n));
  }
  const candidates=grid.map((settings,i)=>{
    const s=sums[i];
    return {settings,net:rounded(s.gain/n),service:rounded(s.service/n),changes:s.changes,
      netLowerSE:lower(s.gain,s.gain2),serviceLowerSE:lower(s.service,s.service2)};
  });
  assert.deepEqual(candidates,model.selection.candidates);
  const feasible=candidates.filter(r=>r.serviceLowerSE>=0);
  assert.equal(feasible.length,model.selection.serviceFeasible);
  assert.equal(n,model.selection.weeks);
  const picked=feasible.find(row=>row.netLowerSE===Math.max(...feasible.map(r=>r.netLowerSE)));
  assert.deepEqual(picked.settings,model.settings);
  return grid.length*n;
}
let paired=0,selected=0;
for(const [i,seed] of seeds.entries()) {
  const model=JSON.parse(readFileSync(new URL("model-"+seed+".json",root),"utf8"));
  assert.equal(model.format,"fleet-override-mc-v1");
  assert.equal(model.seed,seed);
  assert.equal(model.trainStart,200000000+i*1000000);
  assert.equal(model.selectStart,model.trainStart+200000);
  assert.equal(model.weeks,11*768);
  const {count,worst}=checkFit(model), rollouts=checkSelection(model);
  console.log("Verified fit",seed,count,"paired deviations; max normal-equation error",worst,";",rollouts,"selection rollouts.");
  paired+=count;selected+=rollouts;
}
console.log("Rebuilt",paired,"paired action returns, both heads of all five fits and",selected,"candidate-policy selection weeks.");
