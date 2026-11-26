import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {FLEET_FAMILIES} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureActions,closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame,flatRiskOnFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {chooseLongRepair,gateAdvantage,longRepairProposal,uncalibratedAdvantage} from "../../docs/lib/longrepair-policy.js";
import {solveFleetRidge} from "../fleetweek/fit.mjs";

const data=new URL("../../docs/data/",import.meta.url);
export const historicalHashes={
  override:"f70b76a430aadf6c0050a2041208d8fc549c0767b98291574971b681e16a05f9",
  uncertainty:"dec9377b49db274f14f0509e5f07d55e3aa2c1ed69a106dccf330fcc82e3fd3c",
  closure:"0589e32ce712efe3a22a977a7d668306ef8ce0e6af4ac664fc9a8253b287e9b2",
};
export const historical=Object.fromEntries(Object.entries(historicalHashes).map(([name,digest])=>{
  const bytes=readFileSync(new URL(name+"/model-13.json",data));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),digest);
  return [name,JSON.parse(bytes)];
}));
export const CONFIG={seeds:[13,37,73,101,211],families:[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES],
  start:600000000,stride:1000000,calibrationOffset:200000,selectionOffset:400000,
  fitCount:768,calibrationCount:384,selectionCount:768,starts:[2,4,6],
  durations:[1,2,3,4,4,5,5],short:[1,2,3],ridge:0.02,serviceCredits:[0,12,30],hurdles:[0,2,5]};
export const ordered=Array.from({length:9},(_,i)=>[Math.floor(i/3),i%3]);
const index=pos=>3*pos[0]+pos[1];
const round=v=>Number(v.toFixed(10));

export function visitWeeks(start,count,durations,visit) {
  for (const [f,family] of CONFIG.families.entries()) for (let k=0;k<count;k++) {
    const seed=start+f*count+k;
    const observations=closureFrames({family,seed,closure:{starts:CONFIG.starts,durations}});
    visit(observations.map(obs=>closureFrame(obs)));
  }
}

// Counterfactual Monte Carlo policy improvement. All nine ordered placements
// need exact returns because truck-ID tie-breaking is part of the dispatcher.
// Only six canonical origins contribute regression rows, one per physical state.
export function tapeTargets(frames,visit) {
  let futureNet=new Float64Array(9), futureService=new Float64Array(9);
  for (let t=9;t>=0;t--) {
    const frame=frames[t], active=isClosureDecision(frame.obs);
    const prepared=active ? prepareClosureValues(frame,historical.closure) : null;
    const net=new Float64Array(9), service=new Float64Array(9);
    for (const [i,positions] of ordered.entries()) {
      const menu=closureActions({...frame.obs,positions});
      const proposal=active && positions[0]<=positions[1] ? longRepairProposal(frame,menu,historical,prepared) : null;
      const constantId=proposal?.constantId ?? flatRiskOnFrame(frame,menu,historical);
      const c=menu.find(a=>a.id===constantId), to=index(c.positions);
      net[i]=c.net+futureNet[to];
      service[i]=c.served+futureService[to];
      if (proposal?.eligible) {
        const a=menu.find(item=>item.id===proposal.closureId), newTo=index(a.positions);
        visit(proposal,[a.net+futureNet[newTo]-net[i],a.served+futureService[newTo]-service[i]],t,positions);
      }
    }
    futureNet=net;
    futureService=service;
  }
}
function trainingRows(start,count,durations) {
  const rows=[];
  visitWeeks(start,count,durations,frames=>tapeTargets(frames,(p,y)=>rows.push({p,y})));
  return rows;
}
function fitHeads(rows) {
  const n=rows.length, d=rows[0].p.x.length, center=Array(d).fill(0), scale=Array(d).fill(0);
  for (const {p} of rows) for (let j=1;j<d;j++) center[j]+=p.x[j]/n;
  for (const {p} of rows) for (let j=1;j<d;j++) scale[j]+=(p.x[j]-center[j])**2/n;
  for (let j=0;j<d;j++) scale[j]=Math.sqrt(scale[j])>1e-8 ? round(Math.sqrt(scale[j])) : 1;
  const means=center.map(round), gram=Array.from({length:d},()=>new Float64Array(d));
  const rhs=[new Float64Array(d),new Float64Array(d)];
  for (const {p,y} of rows) {
    const z=p.x.map((v,j)=>(v-means[j])/scale[j]);
    for (let i=0;i<d;i++) {
      rhs[0][i]+=z[i]*(y[0]-p.priorNet);
      rhs[1][i]+=z[i]*(y[1]-p.priorService);
      for (let j=0;j<=i;j++) gram[i][j]+=z[i]*z[j];
    }
  }
  const [net,service]=solveFleetRidge(gram,rhs,n,CONFIG.ridge);
  return {center:means,scale,net,service,fitExamples:n};
}
function calibrate(rows,heads) {
  const predicted=rows.map(({p})=>uncalibratedAdvantage(p,heads));
  const calibrations=[0,1].map(j=>{
    const mean=rows.reduce((sum,{y})=>sum+y[j],0)/rows.length;
    const predictedMean=predicted.reduce((sum,y)=>sum+y[j],0)/rows.length;
    let xy=0,xx=0;
    for (const [i,{y}] of rows.entries()) {
      const u=predicted[i][j]-predictedMean;
      xy+=u*(y[j]-mean);
      xx+=u*u;
    }
    return {mean:round(mean),predictedMean:round(predictedMean),slope:round(xx>0 ? Math.max(0,Math.min(1.5,xy/xx)) : 0)};
  });
  return {net:calibrations[0],service:calibrations[1],examples:rows.length};
}
export function settingsGrid() {
  const settings=[{constantOnly:true,serviceCredit:0,hurdle:0}];
  for (const serviceCredit of CONFIG.serviceCredits) for (const hurdle of CONFIG.hurdles) {
    settings.push({constantOnly:false,serviceCredit,hurdle});
  }
  return settings;
}
function summary([sum,squares],n) {
  const mean=sum/n, se=Math.sqrt(Math.max(0,(squares-sum*mean)/(n*(n-1))));
  return {mean:round(mean),lowerSE:round(mean-se)};
}
function select(start,model) {
  const settings=settingsGrid(), stats=settings.map(()=>({switches:0,deltas:Array.from({length:4},()=>[0,0])}));
  let n=0;
  visitWeeks(start,CONFIG.selectionCount,CONFIG.durations,frames=>{
    const cache=frames.map(()=>({entries:[],prepared:null}));
    function at(t,pos) {
      const i=index(pos), c=cache[t];
      if (!c.entries[i]) {
        const f=frames[t], menu=closureActions({...f.obs,positions:pos});
        if (isClosureDecision(f.obs)) c.prepared??=prepareClosureValues(f,historical.closure);
        const p=longRepairProposal(f,menu,historical,c.prepared);
        c.entries[i]={menu,p,advantage:gateAdvantage(p,model)};
      }
      return c.entries[i];
    }
    let planner,constant;
    for (let m=-1;m<settings.length;m++) {
      let pos=[0,1],net=0,service=0;
      for (let t=0;t<frames.length;t++) {
        const {p,menu,advantage}=at(t,pos);
        const id=m===-1 ? p.plannerId : chooseLongRepair(p,advantage,settings[m]).chosenId;
        if (m>=0 && id!==p.constantId) stats[m].switches++;
        const a=menu.find(x=>x.id===id);
        pos=a.positions; net+=a.net; service+=a.served;
      }
      if (m===-1) { planner={net,service}; continue; }
      if (m===0) constant={net,service};
      const delta=[net-planner.net,net-constant.net,service-planner.service,service-constant.service];
      for (const [j,v] of delta.entries()) {
        stats[m].deltas[j][0]+=v;
        stats[m].deltas[j][1]+=v*v;
      }
    }
    n++;
  });
  const candidates=stats.map(({switches,deltas},i)=>{
    const [netPlanner,netConstant,servicePlanner,serviceConstant]=deltas.map(row=>summary(row,n));
    return {settings:settings[i],switches,netPlanner,netConstant,servicePlanner,serviceConstant};
  });
  const service=c=>Math.min(c.servicePlanner.mean,c.serviceConstant.mean);
  const net=c=>Math.min(c.netPlanner.lowerSE,c.netConstant.lowerSE);
  const feasible=candidates.filter(c=>service(c)>=0);
  const chosen=(feasible.length ? feasible : candidates).reduce((a,b)=>{
    if (!feasible.length && service(b)!==service(a)) return service(b)>service(a) ? b : a;
    return net(b)>net(a) ? b : a;
  });
  return {settings:chosen.settings,selection:{weeks:n,feasible:feasible.length,candidates}};
}
export function fitLongRepair(seed,short=false) {
  const i=CONFIG.seeds.indexOf(seed);
  assert(i>=0 && (!short || i===0),"Unregistered fit");
  const trainStart=CONFIG.start+CONFIG.stride*i, calibrationStart=trainStart+CONFIG.calibrationOffset,
    selectionStart=trainStart+CONFIG.selectionOffset, durations=short ? CONFIG.short : CONFIG.durations;
  const heads=fitHeads(trainingRows(trainStart,CONFIG.fitCount,durations));
  const calibration=calibrate(trainingRows(calibrationStart,CONFIG.calibrationCount,CONFIG.durations),heads);
  const model={...heads,calibration};
  return {format:"fleet-longrepair-gate-v1",seed,short,historicalHashes,trainStart,calibrationStart,selectionStart,
    fitDurations:durations,fitWeeks:CONFIG.fitCount*CONFIG.families.length,
    calibrationWeeks:CONFIG.calibrationCount*CONFIG.families.length,...model,...select(selectionStart,model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,which]=process.argv.slice(2);
  assert(["--write","--check"].includes(mode),"Choose --write or --check, optionally followed by a seed or short-13");
  const dir=new URL("longrepair/",data);
  if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const name of which===undefined ? [...CONFIG.seeds,"short-13"] : [which]) {
    const short=name==="short-13",seed=short ? 13 : Number(name);
    const model=fitLongRepair(seed,short), text=JSON.stringify(model)+"\n";
    const file=new URL((short ? "short-" : "fit-")+seed+".json",dir);
    if (mode==="--write") writeFileSync(file,text);
    else assert.equal(readFileSync(file,"utf8"),text,"Checkpoint mismatch");
    console.log(mode,name,model.fitExamples,"paired counterfactuals;",model.calibration.examples,"calibration pairs;",model.settings);
  }
}
