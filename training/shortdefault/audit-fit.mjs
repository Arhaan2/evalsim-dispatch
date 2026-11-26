// Independent check: construct both Friday outcomes by forward dispatch on the
// frozen short policy. Do not import the trainer, its labels or its selector.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {FLEET_PAIRS,FLEET_FAMILIES} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureActions,closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {longRepairDecision,longRepairProposal} from "../../docs/lib/longrepair-policy.js";

const data=new URL("../../docs/data/",import.meta.url), weights={}, hashes={};
const paths={override:"override/model-13",uncertainty:"uncertainty/model-13",closure:"closure/model-13",
  short:"longrepair/short-13",long:"longrepair/fit-13"};
for (const [name,file] of Object.entries(paths)) {
  const bytes=readFileSync(new URL(file+".json",data));
  weights[name]=JSON.parse(bytes);hashes[name]=createHash("sha256").update(bytes).digest("hex");
}
const seeds=[13,37,73,101,211],families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
function weeks(start,n,visit) {
  families.forEach((family,i)=>{
    for (let j=0;j<n;j++) {
      const obs=closureFrames({family,seed:start+i*n+j,closure:{starts:[2,4,6],durations:[1,2,3,4,4,5,5]}});
      visit(obs.map(o=>({f:closureFrame(o),entries:new Map(),prepared:null})));
    }
  });
}
function lookup(board,pos) {
  const k=3*pos[0]+pos[1];
  if (board.entries.has(k)) return board.entries.get(k);
  const {f}=board,menu=closureActions({...f.obs,positions:pos});
  if (isClosureDecision(f.obs)) board.prepared??=prepareClosureValues(f,weights.closure);
  const old=longRepairProposal(f,menu,weights,board.prepared);
  const s=longRepairDecision(old,weights.short),l=longRepairDecision(old,weights.long);
  const short=menu.find(a=>a.id===s.chosenId),long=menu.find(a=>a.id===l.chosenId);
  const direction=long.id===old.closureId ? 1 : -1;
  const x=short.id===long.id ? null : [1,...old.x.slice(1).map(v=>direction*v),direction,
    direction*s.expectedNet,direction*s.expectedService,direction*l.expectedNet,direction*l.expectedService];
  const prior=[direction*(s.expectedNet+l.expectedNet)/2,direction*(s.expectedService+l.expectedService)/2];
  const row={short,long,direction,x,prior};
  board.entries.set(k,row);
  return row;
}
function friday(frames,t,a) {
  let pos=a.positions,net=a.net,served=a.served;
  for (let k=t+1;k<10;k++) {
    const {short}=lookup(frames[k],pos);pos=short.positions;net+=short.net;served+=short.served;
  }
  return [net,served];
}
function pairs(start,count,visit) {
  weeks(start,count,frames=>frames.forEach((board,t)=>{
    if (!isClosureDecision(board.f.obs)) return;
    for (const pos of FLEET_PAIRS) {
      const row=lookup(board,pos);
      if (!row.x) continue;
      const a=friday(frames,t,row.short),b=friday(frames,t,row.long);
      visit(row,[b[0]-a[0],b[1]-a[1]]);
    }
  }));
}
const near=(a,b,eps=1e-8)=>assert(Math.abs(a-b)<eps,`${a} differs from ${b}`);
const zFor=(row,m)=>row.x.map((v,j)=>j===0 ? 1 : (v-m.center[j])/m.scale[j]);
function raw(row,m,z=zFor(row,m)) {
  return [m.net,m.service].map((head,k)=>head.reduce((total,w,j)=>total+w*z[j],row.prior[k]));
}
function checkHeads(m) {
  const grads=[m.net,m.service].map(h=>h.map(()=>0)),sums=m.net.map(()=>0),squares=sums.slice();
  let n=0,positive=0;
  pairs(m.trainStart,4096,(row,y)=>{
    const z=zFor(row,m),v=raw(row,m,z);
    for (let j=0;j<row.x.length;j++) {
      sums[j]+=row.x[j];squares[j]+=row.x[j]**2;
      for (let k=0;k<2;k++) grads[k][j]+=z[j]*(y[k]-v[k]);
    }
    n++;if (row.direction===1) positive++;
  });
  assert.equal(n,m.fitExamples);assert.equal(positive,m.longTookClosure);
  let max=0;
  for (let j=0;j<m.net.length;j++) {
    if (j>0) {
      const mean=sums[j]/n,sd=Math.sqrt(Math.max(0,squares[j]/n-mean**2));
      near(mean,m.center[j]);
      if (m.scale[j]!==1 || sd>1e-5) near(sd,m.scale[j],1e-6);
    }
    for (const [k,head] of [m.net,m.service].entries()) {
      max=Math.max(max,Math.abs(grads[k][j]/n-(j ? .05*head[j] : 0)));
    }
  }
  assert(max<1e-6,"Ridge residual "+max);
  return max;
}
function checkCalibration(m) {
  const stats=[[0,0,0,0],[0,0,0,0]];let n=0;
  pairs(m.calibrationStart,1024,(row,y)=>{
    raw(row,m).forEach((x,j)=>{
      const a=stats[j];a[0]+=x;a[1]+=y[j];a[2]+=x*x;a[3]+=x*y[j];
    });n++;
  });
  assert.equal(n,m.calibration.examples);
  for (const [j,cal] of [m.calibration.net,m.calibration.service].entries()) {
    const [sx,sy,ss,xy]=stats[j],v=ss-sx*sx/n;
    near(cal.mean,sy/n);near(cal.predictedMean,sx/n);
    near(cal.slope,v>0 ? Math.max(0,Math.min(1.5,(xy-sx*sy/n)/v)) : 0);
  }
}
function checkSelection(m) {
  const settings=[{shortOnly:true,serviceCredit:0,hurdle:0}];
  for (const serviceCredit of [0,12,30]) for (const hurdle of [0,2,5,10]) settings.push({shortOnly:false,serviceCredit,hurdle});
  assert.deepEqual(m.selection.candidates.map(c=>c.settings),settings);
  const sums=settings.map(()=>[0,0,0,0,0]);let weeksSeen=0;
  weeks(m.selectionStart,2048,frames=>{
    const outcomes=settings.map((s,i)=>{
      let pos=[0,1],net=0,served=0;
      for (const board of frames) {
        const row=lookup(board,pos);
        let a=row.short;
        if (!s.shortOnly && row.x) {
          row.est??=raw(row,m).map((v,k)=>{
            const c=k===0 ? m.calibration.net : m.calibration.service;
            return c.mean+c.slope*(v-c.predictedMean);
          });
          const [v,c]=row.est;
          if (v>s.hurdle && v+s.serviceCredit*c>s.hurdle) {a=row.long;sums[i][4]++;}
        }
        pos=a.positions;net+=a.net;served+=a.served;
      }
      return [net,served];
    });
    outcomes.forEach(([net,served],i)=>{
      const d=net-outcomes[0][0],u=served-outcomes[0][1],s=sums[i];
      s[0]+=d;s[1]+=d*d;s[2]+=u;s[3]+=u*u;
    });weeksSeen++;
  });
  assert.equal(weeksSeen,m.selection.weeks);
  sums.forEach((a,i)=>{
    const c=m.selection.candidates[i];assert.equal(a[4],c.switches);
    for (const [j,metric] of [c.netShort,c.serviceShort].entries()) {
      const sum=a[j*2],mean=sum/weeksSeen,ss=a[j*2+1];
      near(metric.mean,mean);near(metric.lowerSE,mean-Math.sqrt(Math.max(0,ss-sum*mean)/(weeksSeen*(weeksSeen-1))));
    }
  });
  const eligible=m.selection.candidates.filter(c=>c.netShort.lowerSE>0 && c.serviceShort.mean>=0);
  const chosen=eligible.find(c=>c.netShort.lowerSE===Math.max(...eligible.map(r=>r.netShort.lowerSE))) ?? m.selection.candidates[0];
  assert.equal(m.selection.feasible,eligible.length);assert.deepEqual(chosen.settings,m.settings);
}
for (const seed of process.argv[2] ? [Number(process.argv[2])] : seeds) {
  assert(seeds.includes(seed));
  const m=JSON.parse(readFileSync(new URL("shortdefault/fit-"+seed+".json",data)));
  assert.equal(m.format,"fleet-shortdefault-mc-v1");assert.deepEqual(m.historicalHashes,hashes);assert.equal(m.seed,seed);
  assert.equal(m.trainStart,700000000+1000000*seeds.indexOf(seed));assert.equal(m.calibrationStart,m.trainStart+200000);
  assert.equal(m.selectionStart,m.trainStart+400000);assert.equal(m.fitWeeks,4096*families.length);
  assert.equal(m.calibrationWeeks,1024*families.length);
  const residual=checkHeads(m);checkCalibration(m);checkSelection(m);
  console.log("Audited",seed,m.fitExamples,"Friday pairs,",m.calibration.examples,"calibration pairs, 13 policies; max residual",residual.toExponential(2));
}
