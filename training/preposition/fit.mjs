// A single warning-board policy-improvement step. Identical freight and public
// notices are used for every action; fit 73 operates both trucks on each suffix.
import assert from "node:assert/strict";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {FLEET_PAIRS,fleetPairIndex} from "../../docs/lib/fleetweek.js";
import {closureActions,closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {switchCostDecision,switchCostProposal} from "../../docs/lib/switchcost-policy.js";
import {prepositionProposal,choosePosition,predictMenus} from "../../docs/lib/preposition-policy.js";
import {weights} from "../addguard/fit.mjs";
import {CONFIG} from "../longrepair/fit.mjs";
import {solveFleetRidge} from "../fleetweek/fit.mjs";
export {weights};
export const config={seeds:[73,101,211],base:1200000000,stride:5000000,selectionOffset:1000000,
  fitCount:2048,selectionCount:1024,families:CONFIG.families,starts:[2,3,4,5,6,7,8],
  durations:[1,2,3,4,4,5,5],ridge:.02,serviceCredits:[0,4,12,24,48],hurdles:[0,2,6]};

export function visit(start,count,consume) {
  for (const [i,family] of config.families.entries()) for (let j=0;j<count;j++) {
    const seed=start+i*count+j;
    const c={seed,family,closure:{starts:config.starts,durations:config.durations}};
    consume(warningWeek(c));
  }
}

export function warningWeek(c) {
  const obs=closureFrames(c),frames=obs.map(closureFrame),warning=obs.findIndex(o=>o.incident.status==="warning");
  assert(warning>=0);
  const prepared=[],cache=frames.map(()=>new Map());
  function chooseParent(t,positions,menu) {
    if (isClosureDecision(obs[t])) prepared[t]??=prepareClosureValues(frames[t],weights.closure);
    const p=switchCostProposal(frames[t],menu,weights,prepared[t]);
    return switchCostDecision(p,weights.parent).chosenId;
  }
  function suffix(t,positions) {
    if (t===10) return {net:0,service:0};
    const k=positions[0]*3+positions[1],m=cache[t];
    if (!m.has(k)) {
      const menu=closureActions({...obs[t],positions}),id=chooseParent(t,positions,menu);
      const action=menu.find(a=>a.id===id),next=suffix(t+1,action.positions);
      m.set(k,{net:action.net+next.net,service:action.served+next.service});
    }
    return m.get(k);
  }
  let positions=[0,1];
  for (let t=0;t<warning;t++) {
    const menu=closureActions({...obs[t],positions});
    const id=chooseParent(t,positions,menu);
    positions=menu.find(a=>a.id===id).positions;
  }
  const menu=closureActions({...obs[warning],positions});
  const proposal=prepositionProposal(frames[warning],menu,weights);
  const ordered=Array.from({length:9},(_,i)=>suffix(warning+1,[Math.floor(i/3),i%3]));
  const payoff=new Map(menu.map(a=>{
    const s=ordered[3*a.positions[0]+a.positions[1]];
    return [a.id,{net:a.net+s.net,service:a.served+s.service}];
  }));
  return {proposal,ordered,payoff};
}
export function centeredTargets(ordered) {
  const tails=FLEET_PAIRS.map(([a,b])=>{
    const ab=ordered[a*3+b],ba=ordered[b*3+a];
    return [(ab.net+ba.net)/2,(ab.service+ba.service)/2];
  });
  const means=[0,1].map(k=>tails.reduce((s,y)=>s+y[k],0)/tails.length);
  return tails.map(y=>y.map((v,k)=>v-means[k]));
}
function regress(start) {
  let gram,rhs,rows=0,weeks=0,actions=0,asymmetric=0;
  visit(start,config.fitCount,({proposal,ordered,payoff})=>{
    const {x,base}=proposal.features;
    const d=x[0].length;
    gram??=Array.from({length:d},()=>new Float64Array(d));
    rhs??=[new Float64Array(d),new Float64Array(d)];
    weeks++;actions+=payoff.size;
    if (FLEET_PAIRS.some(([a,b])=>ordered[3*a+b].net!==ordered[3*b+a].net || ordered[3*a+b].service!==ordered[3*b+a].service)) asymmetric++;
    const targets=centeredTargets(ordered);
    for (const [p,f] of x.entries()) {
      const [net,service]=targets[p];
      rows++;
      for (let j=0;j<d;j++) {
        rhs[0][j]+=f[j]*(net-base[p]);rhs[1][j]+=f[j]*service;
        for (let k=0;k<=j;k++) gram[j][k]+=f[j]*f[k];
      }
    }
  });
  const [net,service]=solveFleetRidge(gram,rhs,rows,config.ridge);
  return {net,service,training:{weeks,rows,legalActionBranches:actions,orderedSuffixes:weeks*9,asymmetricWeeks:asymmetric}};
}
export function selectCandidate(candidates) {
  const active=candidates.filter(c=>c.changed>0);
  assert(active.length,"The trained candidate grid made no intervention.");
  const joint=active.filter(c=>c.net>0 && c.service>0);
  const value=joint.length ? c=>c.net : c=>Math.min(c.net,34*c.service);
  const best=(joint.length ? joint : active).reduce((a,b)=>value(b)>value(a) ||
    (value(b)===value(a) && b.service>a.service) ? b : a);
  return {settings:{serviceCredit:best.serviceCredit,hurdle:best.hurdle},jointCandidates:joint.length};
}
function select(start,model) {
  const candidates=config.serviceCredits.flatMap(serviceCredit=>config.hurdles.map(hurdle=>({
    serviceCredit,hurdle,changed:0,net:0,service:0,moreDelivered:0,fewerDelivered:0,positionChanges:0})));
  let weeks=0;
  visit(start,config.selectionCount,({proposal,payoff})=>{
    weeks++;
    const scores=predictMenus(proposal,model),parent=payoff.get(proposal.parentId);
    const destinations=new Map(proposal.menu.map(a=>[a.id,fleetPairIndex(a.positions)]));
    for (const c of candidates) {
      const {chosenId}=choosePosition(scores,proposal.parentId,c);
      const p=payoff.get(chosenId),delivery=p.service-parent.service;
      c.changed+=Number(chosenId!==proposal.parentId);
      c.positionChanges+=Number(destinations.get(chosenId)!==destinations.get(proposal.parentId));
      c.net+=p.net-parent.net;c.service+=delivery;
      c.moreDelivered+=Math.max(0,delivery);c.fewerDelivered+=Math.max(0,-delivery);
    }
  });
  return {...selectCandidate(candidates),selection:{weeks,candidates}};
}
export function fit(seed) {
  const i=config.seeds.indexOf(seed);
  assert(i!==-1,"Unknown preposition training seed.");
  const start=config.base+i*config.stride,selectionStart=start+config.selectionOffset;
  const model=regress(start);
  return {format:"fleet-preposition-v1",seed,parentSeed:73,parentHash:"b40441315416d9866f032759566f1b8f72bf7280c6ecb57c709a7867f8dfb18c",
    trainStart:start,selectionStart,ridge:config.ridge,...model,...select(selectionStart,model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,arg]=process.argv.slice(2);
  assert(["--write","--check"].includes(mode));
  const dir=new URL("../../docs/data/preposition/",import.meta.url);
  if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const seed of arg===undefined ? config.seeds : [Number(arg)]) {
    const model=fit(seed),file=new URL("fit-"+seed+".json",dir),bytes=JSON.stringify(model)+"\n";
    if (mode==="--check") assert.equal(readFileSync(file,"utf8"),bytes);
    else writeFileSync(file,bytes);
    console.log(mode,seed,model.training,model.settings,model.selection.candidates.find(c=>c.serviceCredit===model.settings.serviceCredit && c.hurdle===model.settings.hurdle));
  }
}
