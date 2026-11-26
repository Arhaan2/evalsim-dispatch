import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {FLEET_FAMILIES,FLEET_PAIRS} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureActions,closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame,flatRiskOnFrame} from "../../docs/lib/closure-planner.js";
import {closureChoices,closureEstimates,closureFeatures,isClosureDecision,prepareClosureValues,selectClosure} from "../../docs/lib/closure-policy.js";
import {solveFleetRidge} from "../fleetweek/fit.mjs";

const data=new URL("../../docs/data/",import.meta.url);
const historicalHashes={
  override:"f70b76a430aadf6c0050a2041208d8fc549c0767b98291574971b681e16a05f9",
  uncertainty:"dec9377b49db274f14f0509e5f07d55e3aa2c1ed69a106dccf330fcc82e3fd3c",
};
export const historical=Object.fromEntries(Object.entries(historicalHashes).map(([name,digest])=>{
  const bytes=readFileSync(new URL(name+"/model-13.json",data));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),digest);
  return [name,JSON.parse(bytes)];
}));
export const CONFIG=Object.freeze({seeds:[13,37,73,101,211],
  families:[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES],start:500000000,stride:1000000,
  calibrationOffset:200000,selectionOffset:400000,fitCount:384,calibrationCount:128,selectionCount:384,
  starts:[2,4,6],durations:[1,2,3],ridge:0.01,blends:[0.5,1],serviceCredits:[0,12,30],hurdles:[0,2,5]});
const ordered=Array.from({length:9},(_,i)=>[Math.floor(i/3),i%3]);
const index=pos=>3*pos[0]+pos[1];
const rounded=n=>Number(n.toFixed(8));
const dot=(x,w)=>x.reduce((a,v,i)=>a+v*w[i],0);

function weeks(start,n,visit) {
  for (const [f,family] of CONFIG.families.entries()) for (let k=0;k<n;k++) {
    const observations=closureFrames({family,seed:start+f*n+k,
      closure:{starts:CONFIG.starts,durations:CONFIG.durations}});
    visit(observations.map(obs=>closureFrame(obs)));
  }
}

// Ordered recurrences keep truck-ID tie breaks. Train one symmetric prediction
// for each physical placement by averaging both possible truck orderings.
function centeredPlacement(totals) {
  const six=FLEET_PAIRS.map(([a,b])=>(totals[3*a+b]+totals[3*b+a])/2);
  const mean=six.reduce((s,v)=>s+v,0)/six.length;
  return six.map(v=>v-mean);
}
function visitTargets(start,n,visit) {
  weeks(start,n,frames=>{
    let net=new Float64Array(9), service=new Float64Array(9);
    for (let t=9;t>=0;t--) {
      const frame=frames[t];
      if (isClosureDecision(frame.obs)) {
        const features=closureFeatures(frame), returns=centeredPlacement(net), served=centeredPlacement(service);
        for (const [i,x] of features.x.entries()) visit(x,returns[i]-features.base[i],served[i]-features.service[i]);
      }
      const nextNet=new Float64Array(9), nextService=new Float64Array(9);
      for (const [i,positions] of ordered.entries()) {
        const menu=closureActions({...frame.obs,positions});
        const id=flatRiskOnFrame(frame,menu,historical);
        const action=menu.find(a=>a.id===id), to=index(action.positions);
        nextNet[i]=action.net+net[to];
        nextService[i]=action.served+service[to];
      }
      net=nextNet;service=nextService;
    }
  });
}

function fitHeads(start) {
  let gram, rhs, count=0;
  visitTargets(start,CONFIG.fitCount,(x,net,service)=>{
    gram ??= x.map(()=>new Float64Array(x.length));
    rhs ??= [new Float64Array(x.length),new Float64Array(x.length)];
    for (let i=0;i<x.length;i++) {
      if (!x[i]) continue;
      rhs[0][i]+=x[i]*net;rhs[1][i]+=x[i]*service;
      for (let j=0;j<=i;j++) gram[i][j]+=x[i]*x[j];
    }
    count++;
  });
  const [net,service]=solveFleetRidge(gram,rhs,count,CONFIG.ridge);
  return {net,service,fitExamples:count};
}

function calibrate(start,model) {
  const xy=[0,0], xx=[0,0];
  let count=0;
  visitTargets(start,CONFIG.calibrationCount,(x,net,service)=>{
    const targets=[net,service], fitted=[dot(x,model.net),dot(x,model.service)];
    for (let i=0;i<2;i++) {xy[i]+=fitted[i]*targets[i];xx[i]+=fitted[i]**2;}
    count++;
  });
  const scale=i=>rounded(xx[i]>0 ? Math.max(0,Math.min(1.5,xy[i]/xx[i])) : 0);
  return {net:scale(0),service:scale(1),examples:count};
}

export function closureSettings() {
  const rows=[{blend:0,serviceCredit:0,hurdle:0,constantOnly:true}];
  for (const blend of CONFIG.blends) for (const serviceCredit of CONFIG.serviceCredits)
    for (const hurdle of CONFIG.hurdles) rows.push({blend,serviceCredit,hurdle,constantOnly:false});
  return rows;
}
function pairedSummary(total,sq,n) {
  const mean=total/n, se=Math.sqrt(Math.max(0,(sq-total*mean)/(n*(n-1))));
  return {mean:rounded(mean),lowerSE:rounded(mean-se)};
}
function select(start,model) {
  const settings=closureSettings(), sums=settings.map(()=>({switches:0,
    deltas:Array.from({length:4},()=>[0,0])}));
  let n=0;
  weeks(start,CONFIG.selectionCount,frames=>{
    const memo=frames.map(()=>({positions:[],values:null}));
    function actionAt(t,pos,mode) {
      const f=frames[t], cache=memo[t], i=index(pos);
      let entry=cache.positions[i];
      if (!entry) {
        const menu=closureActions({...f.obs,positions:pos}), choices=closureChoices(f,menu,historical);
        if (choices.alternatives.length) cache.values ??= prepareClosureValues(f,model);
        const estimates=closureEstimates(f,choices,model,cache.values);
        entry={menu,choices,estimates};
        cache.positions[i]=entry;
      }
      const {menu,choices,estimates}=entry;
      if (mode===-1) return menu.find(a=>a.id===choices.plannerId);
      if (mode===0 || !estimates.length) return choices.constant;
      const selected=selectClosure(choices,estimates,settings[mode]);
      if (selected.chosenId!==choices.constant.id) sums[mode].switches++;
      return menu.find(a=>a.id===selected.chosenId);
    }
    let planner,constant;
    for (let i=-1;i<settings.length;i++) {
      let pos=[0,1],net=0,service=0;
      for (let t=0;t<10;t++) {
        const a=actionAt(t,pos,i); pos=a.positions;net+=a.net;service+=a.served;
      }
      if (i===-1) {planner={net,service};continue;}
      if (i===0) constant={net,service};
      const deltas=[net-planner.net,net-constant.net,service-planner.service,service-constant.service];
      for (const [j,d] of deltas.entries()) {sums[i].deltas[j][0]+=d;sums[i].deltas[j][1]+=d*d;}
    }
    n++;
  });
  const candidates=sums.map(({switches,deltas},i)=>{
    const [netPlanner,netConstant,servicePlanner,serviceConstant]=deltas.map(([s,q])=>pairedSummary(s,q,n));
    return {settings:settings[i],switches,netPlanner,netConstant,servicePlanner,serviceConstant};
  });
  const eligible=candidates.filter(c=>c.servicePlanner.lowerSE>=0 && c.serviceConstant.lowerSE>=0);
  const merit=c=>Math.min(c.netPlanner.lowerSE,c.netConstant.lowerSE);
  const chosen=eligible.length ? eligible.reduce((a,b)=>merit(b)>merit(a) ? b : a) : candidates[0];
  return {settings:chosen.settings,selection:{weeks:n,feasible:eligible.length,candidates}};
}

export function fitClosure(seed) {
  const i=CONFIG.seeds.indexOf(seed);assert(i>=0,"Unregistered seed");
  const trainStart=CONFIG.start+CONFIG.stride*i, calibrationStart=trainStart+CONFIG.calibrationOffset,
    selectionStart=trainStart+CONFIG.selectionOffset;
  const heads=fitHeads(trainStart);
  const model={...heads,calibration:calibrate(calibrationStart,heads)};
  return {format:"fleet-closure-mc-v1",seed,historicalHashes,trainStart,calibrationStart,selectionStart,
    fitWeeks:CONFIG.fitCount*CONFIG.families.length,calibrationWeeks:CONFIG.calibrationCount*CONFIG.families.length,
    ...model,...select(selectionStart,model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,which]=process.argv.slice(2);
  if (!["--write","--check"].includes(mode)) throw Error("Choose --write or --check, then optionally one registered seed.");
  const dir=new URL("closure/",data);
  if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const seed of which===undefined ? CONFIG.seeds : [Number(which)]) {
    const model=fitClosure(seed), text=JSON.stringify(model)+"\n", file=new URL("model-"+seed+".json",dir);
    if (mode==="--write") writeFileSync(file,text);
    else assert.equal(readFileSync(file,"utf8"),text,"Checkpoint mismatch");
    console.log(mode,seed,model.fitExamples,"placement targets;",model.calibration.examples,"for calibration;",model.settings);
  }
}
