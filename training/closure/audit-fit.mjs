// Audit the five deployed fits without importing the training algorithm.
// Roll each counterfactual truck placement forward to Friday on its own named-truck path.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {FLEET_FAMILIES,FLEET_PAIRS,fleetPairIndex} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureActions,closureFrames} from "../../docs/lib/closure-world.js";
import {bestFleetAction} from "../../docs/lib/fleetweek-planner.js";
import {closureFrame,flatRiskOnFrame} from "../../docs/lib/closure-planner.js";
import {distinctOverrides} from "../../docs/lib/override-policy.js";
import {closureFeatures,isClosureDecision} from "../../docs/lib/closure-policy.js";

const data=new URL("../../docs/data/",import.meta.url);
const reference={};
const hashes={};
for(const name of ["override","uncertainty"]) {
  const bytes=readFileSync(new URL(name+"/model-13.json",data));
  hashes[name]=createHash("sha256").update(bytes).digest("hex");
  reference[name]=JSON.parse(bytes);
}
const round=x=>Number(x.toFixed(8));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
function schedules(start,count,visit) {
  for(const [i,family] of families.entries()) for(let j=0;j<count;j++) {
    const observations=closureFrames({family,seed:start+i*count+j,closure:{starts:[2,4,6],durations:[1,2,3]}});
    visit(observations.map(obs=>({f:closureFrame(obs),cache:new Map()})));
  }
}
function choices(entry,pos) {
  const key=pos.join("/");
  if(!entry.cache.has(key)) {
    const frame=entry.f;
    const menu=closureActions({...frame.obs,positions:pos});
    const flatId=flatRiskOnFrame(frame,menu,reference);
    const planId=bestFleetAction(menu,frame.base);
    entry.cache.set(key,{menu,flat:menu.find(a=>a.id===flatId),plan:menu.find(a=>a.id===planId)});
  }
  return entry.cache.get(key);
}
function suffix(frames,epoch,starting) {
  let net=0,service=0,pos=starting;
  for(let t=epoch+1;t<10;t++) {
    const {flat}=choices(frames[t],pos);
    net+=flat.net;service+=flat.served;pos=flat.positions;
  }
  return [net,service];
}
function targets(start,count,visit) {
  schedules(start,count,frames=>{
    for(const [t,{f}] of frames.entries()) {
      if(!isClosureDecision(f.obs)) continue;
      const x=closureFeatures(f), expected=FLEET_PAIRS.map(([a,b])=>{
        const u=suffix(frames,t,[a,b]),v=suffix(frames,t,[b,a]);
        return u.map((n,j)=>(n+v[j])/2);
      });
      const mean=[0,1].map(j=>expected.reduce((s,row)=>s+row[j],0)/6);
      for(let i=0;i<6;i++) visit(x.x[i],expected[i][0]-mean[0]-x.base[i],
        expected[i][1]-mean[1]-x.service[i]);
    }
  });
}
function checkFit(m) {
  const grads=[new Float64Array(m.net.length),new Float64Array(m.service.length)], weights=[m.net,m.service];
  let n=0;
  targets(m.trainStart,384,(x,y,s)=>{
    for(const [k,target] of [y,s].entries()) {
      const error=target-dot(x,weights[k]);
      for(let j=0;j<x.length;j++) grads[k][j]+=x[j]*error;
    }
    n++;
  });
  assert.equal(n,m.fitExamples);
  let max=0;
  for(let i=0;i<2;i++) for(let j=0;j<weights[i].length;j++) {
    max=Math.max(max,Math.abs(grads[i][j]/n-(j===0 ? 0 : 0.01*weights[i][j])));
  }
  assert(max<1e-6,"Ridge optimality residual "+max);
  return max;
}
function checkCalibration(m) {
  const xy=[0,0],xx=[0,0];
  let n=0;
  targets(m.calibrationStart,128,(x,y,s)=>{
    const predictions=[dot(x,m.net),dot(x,m.service)];
    for(const [i,t] of [y,s].entries()) {xy[i]+=predictions[i]*t;xx[i]+=predictions[i]**2;}
    n++;
  });
  assert.equal(n,m.calibration.examples);
  for(const [i,k] of ["net","service"].entries()) {
    const scale=xx[i]===0 ? 0 : round(Math.max(0,Math.min(1.5,xy[i]/xx[i])));
    assert.equal(m.calibration[k],scale);
  }
}

function checkSelection(m) {
  const grid=[{blend:0,serviceCredit:0,hurdle:0,constantOnly:true}];
  for(const blend of [.5,1]) for(const serviceCredit of [0,12,30]) for(const hurdle of [0,2,5])
    grid.push({blend,serviceCredit,hurdle,constantOnly:false});
  assert.deepEqual(grid,m.selection.candidates.map(row=>row.settings));
  const sums=grid.map(()=>({switches:0,totals:new Float64Array(4),squares:new Float64Array(4)}));
  let n=0;
  schedules(m.selectionStart,384,frames=>{
    const ledgers=[{plan:true},...grid].map((option,i)=>{
      let pos=[0,1],net=0,served=0;
      for(const entry of frames) {
        const {f}=entry, alternatives=choices(entry,pos);
        let action=option.plan ? alternatives.plan : alternatives.flat;
        if(i>1 && isClosureDecision(f.obs)) {
          if(!alternatives.scores) {
            const candidate=distinctOverrides(alternatives.menu,action);
            if(candidate.length && !entry.pred) {
              const feat=closureFeatures(f);
              entry.pred={net:feat.x.map(x=>dot(x,m.net)*m.calibration.net),
                service:feat.x.map((x,k)=>feat.service[k]+dot(x,m.service)*m.calibration.service)};
            }
            const from=fleetPairIndex(action.positions);
            alternatives.scores=candidate.map(a=>{
              const to=fleetPairIndex(a.positions), pred=entry.pred;
              return {a,prior:a.net-action.net+f.base[to]-f.base[from],
                residual:pred.net[to]-pred.net[from],service:pred.service[to]-pred.service[from]};
            });
          }
          let best=option.hurdle;
          for(const v of alternatives.scores) {
            const score=v.prior+option.blend*v.residual+option.serviceCredit*v.service;
            if(score>best) {action=v.a;best=score;}
          }
          if(action.id!==alternatives.flat.id) sums[i-1].switches++;
        }
        pos=action.positions;net+=action.net;served+=action.served;
      }
      return {net,served};
    });
    const [plan,flat]=ledgers;
    for(const [i,x] of ledgers.slice(1).entries()) for(const [j,d] of
      [x.net-plan.net,x.net-flat.net,x.served-plan.served,x.served-flat.served].entries()) {
      sums[i].totals[j]+=d;sums[i].squares[j]+=d*d;
    }
    n++;
  });
  assert.equal(n,m.selection.weeks);
  const candidates=m.selection.candidates;
  for(const [i,c] of candidates.entries()) {
    assert.equal(c.switches,sums[i].switches);
    ["netPlanner","netConstant","servicePlanner","serviceConstant"].forEach((key,j)=>{
      const mean=sums[i].totals[j]/n, variance=Math.max(0,(sums[i].squares[j]-n*mean**2)/(n-1));
      assert.deepEqual(c[key],{mean:round(mean),lowerSE:round(mean-Math.sqrt(variance/n))});
    });
  }
  const eligible=candidates.filter(c=>Math.min(c.serviceConstant.lowerSE,c.servicePlanner.lowerSE)>=0);
  assert.equal(eligible.length,m.selection.feasible);
  const score=c=>Math.min(c.netConstant.lowerSE,c.netPlanner.lowerSE);
  const selected=eligible.find(c=>score(c)===Math.max(...eligible.map(score))) ?? candidates[0];
  assert.deepEqual(m.settings,selected.settings);
}

for(const [i,seed] of [13,37,73,101,211].entries()) {
  const m=JSON.parse(readFileSync(new URL("closure/model-"+seed+".json",data)));
  assert.equal(m.format,"fleet-closure-mc-v1");
  assert.equal(m.seed,seed);assert.deepEqual(m.historicalHashes,hashes);
  assert.equal(m.trainStart,500000000+i*1000000);assert.equal(m.calibrationStart,m.trainStart+200000);
  assert.equal(m.selectionStart,m.trainStart+400000);
  assert.equal(m.fitWeeks,384*families.length);assert.equal(m.calibrationWeeks,128*families.length);
  const max=checkFit(m);
  checkCalibration(m);
  checkSelection(m);
  console.log("Audited",seed,m.fitExamples,"placement targets,",m.calibration.examples,
    "calibration targets, 19 selection strategies. Maximum ridge residual",max.toExponential(2));
}
