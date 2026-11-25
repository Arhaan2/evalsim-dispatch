import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createFleetWeek, FLEET_FAMILIES, fleetWeekActions } from "../../docs/lib/fleetweek.js";
import { OVERRIDE_TRAIN_FAMILIES } from "../../docs/lib/override-markets.js";
import { bestFleetAction, fleetPlannerContinuation } from "../../docs/lib/fleetweek-planner.js";
import { isOvernight } from "../../docs/lib/overnight-policy.js";
import { distinctOverrides, overrideContext, overrideEstimates, overrideExample, selectOverride } from "../../docs/lib/override-policy.js";
import { solveFleetRidge } from "../fleetweek/fit.mjs";

export const OVERRIDE_FIT = Object.freeze({
  seeds:[13,37,73,101,211], releaseSeed:13, firstSeed:200000000, fitStride:1000000,
  selectionOffset:200000, weeksPerFamily:768, selectionPerFamily:384, ridge:0.002,
  families:[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES],
  blends:[0.5,1], serviceCredits:[0,12,30], thresholds:[0,2,5],
});
const labeledPairs = Array.from({length:9},(_,i)=>[Math.floor(i/3),i%3]);
const address = positions => 3*positions[0]+positions[1];
export function forOverrideWeeks(start,count,visit) {
  OVERRIDE_FIT.families.forEach((family,i)=>{
    for (let k=0;k<count;k++) visit({family,seed:start+i*count+k});
  });
}

function framesFor(config) {
  const world = createFleetWeek(config), frames=[];
  while (!world.done) {
    const obs=world.observe(), base=fleetPlannerContinuation(obs);
    frames.push({obs,base,context:isOvernight(obs.epoch) ? overrideContext(obs,base) : null});
    world.step("W|W");
  }
  return frames;
}
function publicChoice(obs,positions,base) {
  const menu=fleetWeekActions({...obs,positions});
  const id=bestFleetAction(menu,base);
  return {menu,reference:menu.find(a=>a.id===id)};
}

function fitHeads(start) {
  let gram, rhs, count=0;
  const byNight=[0,0,0,0];
  forOverrideWeeks(start,OVERRIDE_FIT.weeksPerFamily,config=>{
    const frames=framesFor(config);
    let laterNet=new Float64Array(9), laterService=new Float64Array(9);
    for (let epoch=9;epoch>=0;epoch--) {
      const {obs,base,context}=frames[epoch];
      const net=new Float64Array(9), service=new Float64Array(9);
      for (const [p,positions] of labeledPairs.entries()) {
        const {menu,reference}=publicChoice(obs,positions,base);
        const refEnd=address(reference.positions);
        net[p]=reference.net+laterNet[refEnd];
        service[p]=reference.served+laterService[refEnd];
        // One weight per physical starting pair; handle the planner's labeled tie
        // behavior exactly when either branch runs out the remaining week.
        if (!context || positions[0]>positions[1]) continue;
        for (const action of distinctOverrides(menu,reference)) {
          const {features:x,baseline}=overrideExample(context,reference,action);
          gram ??= Array.from(x,()=>new Float64Array(x.length));
          rhs ??= [new Float64Array(x.length),new Float64Array(x.length)];
          const end=address(action.positions);
          const residual=action.net+laterNet[end]-net[p]-baseline;
          const contract=action.served+laterService[end]-service[p];
          for (let i=0;i<x.length;i++) {
            const xi=x[i];
            if (xi===0) continue;
            for (let j=0;j<=i;j++) gram[i][j]+=xi*x[j];
            rhs[0][i]+=xi*residual;
            rhs[1][i]+=xi*contract;
          }
          count++;
          byNight[(epoch-1)/2]++;
        }
      }
      laterNet=net;
      laterService=service;
    }
  });
  const [net,service]=solveFleetRidge(gram,rhs,count,OVERRIDE_FIT.ridge);
  return {net,service,features:net.length,examples:count,byNight};
}

export function overrideSettings() {
  const {blends,serviceCredits,thresholds}=OVERRIDE_FIT;
  return [
    {blend:1,serviceCredit:0,threshold:0,plannerOnly:true},
    ...blends.flatMap(blend=>serviceCredits.flatMap(serviceCredit=>
      thresholds.map(threshold=>({blend,serviceCredit,threshold,plannerOnly:false})))),
  ];
}

function runSelectionWeek(frames,settings) {
  let positions=[0,1], net=0, served=0, changes=0;
  for (const frame of frames) {
    const index=address(positions);
    const {reference,menu,alternatives}=frame.choices[index] ??= (() => {
      const choice=publicChoice(frame.obs,positions,frame.base);
      return {...choice, alternatives:frame.context ?
        overrideEstimates(frame.context,choice.menu,choice.reference,frame.model) : []};
    })();
    const id=selectOverride(reference.id,alternatives,settings).chosenId;
    const action=id===reference.id ? reference : menu.find(a=>a.id===id);
    net+=action.net;served+=action.served;changes+=Number(id!==reference.id);
    positions=action.positions;
  }
  return {net,served,changes};
}

const rounded=n=>Number(n.toFixed(8));
function lowerSE(sum,squares,n) {
  return rounded(sum/n - Math.sqrt(Math.max(0,squares - sum*sum/n)/(n*(n-1))));
}
function selectSettings(start,model) {
  const options=overrideSettings();
  const stats=options.map(()=>({net:0,netSquares:0,service:0,serviceSquares:0,changes:0}));
  let weeks=0;
  forOverrideWeeks(start,OVERRIDE_FIT.selectionPerFamily,config=>{
    const frames=framesFor(config).map(f=>({...f,model,choices:[]}));
    const baseline=runSelectionWeek(frames,options[0]);
    options.forEach((settings,i)=>{
      const other=i===0 ? baseline : runSelectionWeek(frames,settings);
      const profit=other.net-baseline.net,contracts=other.served-baseline.served;
      const s=stats[i];
      s.net+=profit;s.netSquares+=profit*profit;
      s.service+=contracts;s.serviceSquares+=contracts*contracts;s.changes+=other.changes;
    });
    weeks++;
  });
  const candidates=options.map((settings,i)=>{
    const s=stats[i];
    return {settings,net:rounded(s.net/weeks),service:rounded(s.service/weeks),changes:s.changes,
      netLowerSE:lowerSE(s.net,s.netSquares,weeks),serviceLowerSE:lowerSE(s.service,s.serviceSquares,weeks)};
  });
  // Planner-only is a real candidate with zero paired differences, including
  // zero uncertainty. Exact ties retain the first registered candidate.
  const feasible=candidates.filter(row=>row.serviceLowerSE>=0);
  const winner=feasible.reduce((best,row)=>row.netLowerSE>best.netLowerSE ? row : best);
  return {settings:winner.settings,selection:{weeks,candidates,serviceFeasible:feasible.length}};
}

export function fitOverride(seed) {
  const index=OVERRIDE_FIT.seeds.indexOf(seed);
  if(index<0) throw RangeError("Unknown registered override fit seed.");
  const trainStart=OVERRIDE_FIT.firstSeed+index*OVERRIDE_FIT.fitStride;
  const selectStart=trainStart+OVERRIDE_FIT.selectionOffset;
  const model=fitHeads(trainStart);
  return {format:"fleet-override-mc-v1",seed,trainStart,selectStart,
    weeks:OVERRIDE_FIT.weeksPerFamily*OVERRIDE_FIT.families.length,
    ...model,...selectSettings(selectStart,model)};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const mode=process.argv[2];
  if (!["--write","--check"].includes(mode)) throw Error("Choose --write to fit or --check to reproduce.");
  const dir=new URL("../../docs/data/override/",import.meta.url);
  if(mode==="--write") mkdirSync(dir,{recursive:true});
  for(const seed of OVERRIDE_FIT.seeds) {
    const model=fitOverride(seed), bytes=JSON.stringify(model)+"\n", path=new URL("model-"+seed+".json",dir);
    if(mode==="--write") writeFileSync(path,bytes);
    else assert.equal(bytes,readFileSync(path,"utf8"),"Checkpoint differs for seed "+seed);
    console.log(mode,seed,model.examples,"paired action returns;",JSON.stringify(model.settings));
  }
}
