// Independent forward rollouts check the backward return labels indirectly via
// ridge optimality. This script never imports the fitter or its suffix tables.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {FLEET_FAMILIES,FLEET_PAIRS} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureFrames,closureActions} from "../../docs/lib/closure-world.js";
import {closureFrame,flatRiskOnFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {longRepairProposal} from "../../docs/lib/longrepair-policy.js";

const data=new URL("../../docs/data/",import.meta.url);
const historical={},digests={};
for (const k of ["closure","override","uncertainty"]) {
  const bytes=readFileSync(new URL(k+"/model-13.json",data));
  historical[k]=JSON.parse(bytes);
  digests[k]=createHash("sha256").update(bytes).digest("hex");
}
const seeds=[13,37,73,101,211], families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
const mixed=[1,2,3,4,4,5,5], short=[1,2,3];
const round=x=>Number(x.toFixed(10));
const near=(a,b,eps=1e-8)=>assert(Math.abs(a-b)<eps,`${a} differs from ${b}`);
function weeks(start,count,durations,visit) {
  families.forEach((family,i)=>{
    for (let j=0;j<count;j++) {
      const frames=closureFrames({family,seed:start+i*count+j,closure:{starts:[2,4,6],durations}});
      visit(frames.map(obs=>({frame:closureFrame(obs),positions:new Map(),prepared:null})));
    }
  });
}
function board(entry,pos,proposal=false) {
  const {frame,positions}=entry, key=pos.join("/");
  if (!positions.has(key)) {
    const menu=closureActions({...frame.obs,positions:pos});
    const id=flatRiskOnFrame(frame,menu,historical);
    positions.set(key,{menu,constant:menu.find(a=>a.id===id)});
  }
  const row=positions.get(key);
  if (proposal && !row.p) {
    if (isClosureDecision(frame.obs)) entry.prepared??=prepareClosureValues(frame,historical.closure);
    row.p=longRepairProposal(frame,row.menu,historical,entry.prepared);
    assert.equal(row.p.constantId,row.constant.id);
  }
  return row;
}
function friday(frames,t,first) {
  let net=first.net,served=first.served,pos=first.positions;
  for (let k=t+1;k<10;k++) {
    const {constant}=board(frames[k],pos);
    net+=constant.net;served+=constant.served;pos=constant.positions;
  }
  return [net,served];
}
function targets(start,count,durations,visit) {
  weeks(start,count,durations,frames=>{
    frames.forEach((entry,t)=>{
      if (!isClosureDecision(entry.frame.obs)) return;
      for (const pos of FLEET_PAIRS) {
        const {menu,constant,p}=board(entry,pos,true);
        if (!p.eligible) continue;
        const a=friday(frames,t,menu.find(move=>move.id===p.closureId)), b=friday(frames,t,constant);
        visit(p,[a[0]-b[0],a[1]-b[1]]);
      }
    });
  });
}
const standardized=(p,m)=>p.x.map((x,j)=>j===0 ? 1 : (x-m.center[j])/m.scale[j]);
function raw(p,z,m) {
  const dot=w=>z.reduce((sum,x,i)=>sum+x*w[i],0);
  return [p.priorNet+dot(m.net),p.priorService+dot(m.service)];
}
function checkFit(m) {
  const grads=[m.net,m.service].map(w=>w.map(()=>0)), sums=m.net.map(()=>0), squares=sums.slice();
  let n=0;
  targets(m.trainStart,768,m.fitDurations,(p,y)=>{
    const z=standardized(p,m), predictions=raw(p,z,m);
    for (let i=0;i<z.length;i++) {
      sums[i]+=p.x[i];squares[i]+=p.x[i]**2;
      for (let j=0;j<2;j++) grads[j][i]+=z[i]*(y[j]-predictions[j]);
    }
    n++;
  });
  assert.equal(n,m.fitExamples);
  for (let i=1;i<sums.length;i++) {
    const mean=sums[i]/n,sigma=Math.sqrt(Math.max(0,squares[i]/n-mean*mean));
    near(m.center[i],mean);
    // Numerically constant columns use scale one. Small apparent variances
    // here can come from subtracting two large nearly-equal second moments.
    if (m.scale[i]!==1 || sigma>0.00001) near(m.scale[i],sigma,1e-6);
  }
  let max=0;
  for (const [j,w] of [m.net,m.service].entries()) w.forEach((v,i)=>{
    max=Math.max(max,Math.abs(grads[j][i]/n-(i ? .02*v : 0)));
  });
  assert(max<1e-6,"Ridge gradient residual "+max);
  return max;
}
function checkCalibration(m) {
  const moments=[new Float64Array(4),new Float64Array(4)];
  let n=0;
  targets(m.calibrationStart,384,mixed,(p,y)=>{
    raw(p,standardized(p,m),m).forEach((v,i)=>{
      const a=moments[i];
      a[0]+=y[i];a[1]+=v;a[2]+=y[i]*v;a[3]+=v*v;
    });
    n++;
  });
  assert.equal(m.calibration.examples,n);
  for (const [i,k] of ["net","service"].entries()) {
    const [y,x,xy,xx]=moments[i], vx=xx-x*x/n;
    const cal=m.calibration[k];
    near(cal.mean,y/n);near(cal.predictedMean,x/n);
    near(cal.slope,vx>0 ? Math.max(0,Math.min(1.5,(xy-y*x/n)/vx)) : 0);
  }
}
function checkSelection(m) {
  const grid=[{constantOnly:true,serviceCredit:0,hurdle:0}];
  for (const serviceCredit of [0,12,30]) for (const hurdle of [0,2,5]) grid.push({constantOnly:false,serviceCredit,hurdle});
  const switches=grid.map(()=>0), moments=grid.map(()=>Array.from({length:4},()=>[0,0]));
  let n=0;
  weeks(m.selectionStart,768,mixed,frames=>{
    const results=[null,...grid].map((s,i)=>{
      let pos=[0,1],net=0,served=0;
      for (const entry of frames) {
        const row=board(entry,pos,true), {p,menu}=row;
        let id=s ? p.constantId : p.plannerId;
        if (s && !s.constantOnly && p.eligible) {
          if (!row.calibrated) row.calibrated=raw(p,standardized(p,m),m).map((v,j)=>{
            const cal=j===0 ? m.calibration.net : m.calibration.service;
            return cal.mean+cal.slope*(v-cal.predictedMean);
          });
          const [v,c]=row.calibrated;
          if (v+s.serviceCredit*c>s.hurdle) {id=p.closureId;switches[i-1]++;}
        }
        const a=menu.find(item=>item.id===id);
        net+=a.net;served+=a.served;pos=a.positions;
      }
      return {net,served};
    });
    const [planner,constant]=results;
    for (const [i,{net,served}] of results.slice(1).entries()) {
      const deltas=[net-planner.net,net-constant.net,served-planner.served,served-constant.served];
      for (const [j,d] of deltas.entries()) {moments[i][j][0]+=d;moments[i][j][1]+=d*d;}
    }
    n++;
  });
  assert.equal(n,m.selection.weeks);
  assert.deepEqual(m.selection.candidates.map(c=>c.settings),grid);
  m.selection.candidates.forEach((c,i)=>{
    assert.equal(c.switches,switches[i]);
    ["netPlanner","netConstant","servicePlanner","serviceConstant"].forEach((key,j)=>{
      const [sum,ss]=moments[i][j],mean=sum/n;
      near(c[key].mean,mean);near(c[key].lowerSE,mean-Math.sqrt(Math.max(0,ss-sum*mean)/(n*(n-1))));
    });
  });
  const service=c=>Math.min(c.servicePlanner.mean,c.serviceConstant.mean);
  const net=c=>Math.min(c.netPlanner.lowerSE,c.netConstant.lowerSE);
  const feasible=m.selection.candidates.filter(c=>service(c)>=0);
  const pool=feasible.length ? feasible : m.selection.candidates.filter(c=>service(c)===Math.max(...m.selection.candidates.map(service)));
  const best=pool.find(c=>net(c)===Math.max(...pool.map(net)));
  assert.equal(m.selection.feasible,feasible.length);assert.deepEqual(m.settings,best.settings);
}

for (const name of process.argv[2] ? [process.argv[2]] : [...seeds,"short-13"]) {
  const control=name==="short-13",seed=control ? 13 : Number(name);
  assert(seeds.includes(seed));
  const file=(control ? "short-" : "fit-")+seed+".json";
  const m=JSON.parse(readFileSync(new URL("longrepair/"+file,data)));
  assert.equal(m.format,"fleet-longrepair-gate-v1");
  assert.equal(m.seed,seed);assert.equal(m.short,control);assert.deepEqual(m.historicalHashes,digests);
  assert.equal(m.trainStart,600000000+1000000*seeds.indexOf(seed));
  assert.equal(m.calibrationStart,m.trainStart+200000);assert.equal(m.selectionStart,m.trainStart+400000);
  assert.deepEqual(m.fitDurations,control ? short : mixed);
  assert.equal(m.fitWeeks,768*families.length);assert.equal(m.calibrationWeeks,384*families.length);
  const max=checkFit(m);
  checkCalibration(m);checkSelection(m);
  console.log("Audited",file,m.fitExamples,"Friday return pairs;",m.calibration.examples,"calibration pairs; all 10 selection strategies; max ridge residual",max.toExponential(2));
}
