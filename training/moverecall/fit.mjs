import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {closureActions} from "../../docs/lib/closure-world.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {chooseMoveRecall,moveRecallEstimates,moveRecallProposal,neighborPrediction,quantize,recallFeatures,recallHeads} from "../../docs/lib/moverecall-policy.js";
import {visitWeeks} from "../longrepair/fit.mjs";
import {weights as older,digests as olderHashes} from "../shortdefault/fit.mjs";

const data=new URL("../../docs/data/",import.meta.url),source=readFileSync(new URL("longmove/fit-13.json",data));
const previousHash="a858e0093d0caad004cd6e9ea3fce6b25d9933213cf42b9c3fe21fb795c8109e";
assert.equal(createHash("sha256").update(source).digest("hex"),previousHash);
export const weights={...older,previous:JSON.parse(source)};
const hashes={...olderHashes,previous:previousHash};
export const config={seeds:[13,37,73,101,211],base:900000000,stride:1000000,calibrationOffset:250000,selectionOffset:500000,
  fitCount:16384,calibrationCount:4096,selectionCount:8192,durations:[1,2,3,4,4,5,5]};
const round=x=>Number(x.toFixed(10));
const targets=r=>[Number(r.net>0),r.net,Math.max(0,-r.net),r.service];

export function replay(frames) {
  const memo=frames.map(()=>({entries:[],prepared:null}));
  function at(t,pos) {
    const f=frames[t],m=memo[t],i=3*pos[0]+pos[1];
    if (!m.entries[i]) {
      if (isClosureDecision(f.obs)) m.prepared??=prepareClosureValues(f,weights.closure);
      const menu=closureActions({...f.obs,positions:pos}),p=moveRecallProposal(f,menu,weights,m.prepared);
      m.entries[i]={p,short:menu.find(a=>a.id===p.shortId),long:menu.find(a=>a.id===p.longId)};
    }
    return m.entries[i];
  }
  function friday(t,a) {
    let net=a.net,served=a.served,pos=a.positions;
    for (let j=t+1;j<10;j++) {
      const s=at(j,pos).short;net+=s.net;served+=s.served;pos=s.positions;
    }
    return [net,served];
  }
  let pos=[0,1],shortNet=0,shortService=0;
  const skipped=[];
  for (let t=0;t<10;t++) {
    const row=at(t,pos);
    if (row.p.rescueEligible) {
      const s=friday(t,row.short),l=friday(t,row.long);
      skipped.push({row,t,pos,net:l[0]-s[0],service:l[1]-s[1]});
    }
    shortNet+=row.short.net;shortService+=row.short.served;pos=row.short.positions;
  }
  return {at,shortNet,shortService,skipped};
}
function collect(start,n) {
  const rows=[];
  visitWeeks(start,n,config.durations,frames=>{
    for (const s of replay(frames).skipped) rows.push({x:recallFeatures(s.row.p),net:s.net,service:s.service});
  });
  return rows;
}
export function fitMetric(rows) {
  assert(rows.length>=64,"Too few skipped disagreements for a 64-case neighborhood");
  const n=rows.length,d=rows[0].x.length,center=Array(d).fill(0),scale=Array(d).fill(0);
  for (const row of rows) for (let j=0;j<d;j++) center[j]+=row.x[j]/n;
  for (const row of rows) for (let j=0;j<d;j++) scale[j]+=(row.x[j]-center[j])**2/n;
  for (let j=0;j<d;j++) {scale[j]=scale[j]>1e-16 ? round(Math.sqrt(scale[j])) : 1;center[j]=round(center[j]);}
  const cases=rows.map(r=>({x:quantize(r.x,{center,scale}),net:r.net,service:r.service}));
  const y=cases.map(targets),mean=[0,0,0,0],ss=[0,0,0,0];
  for (const a of y) for (let k=0;k<4;k++) mean[k]+=a[k]/n;
  for (const a of y) for (let k=0;k<4;k++) ss[k]+=(a[k]-mean[k])**2;
  const metric=[];
  for (let j=0;j<d;j++) {
    const sorted=cases.map(r=>r.x[j]).sort((a,b)=>a-b);
    const cuts=[...new Set(Array.from({length:7},(_,i)=>sorted[Math.floor(n*(i+1)/8)-1]))].filter(v=>v<sorted[n-1]);
    const groups=Array.from({length:cuts.length+1},()=>({n:0,s:[0,0,0,0]}));
    cases.forEach((r,i)=>{
      let k=0;while (k<cuts.length && r.x[j]>cuts[k]) k++;
      const g=groups[k];g.n++;for (let h=0;h<4;h++) g.s[h]+=y[i][h];
    });
    let w=.02;
    for (let h=0;h<4;h++) {
      const between=groups.reduce((s,g)=>s+(g.n ? g.n*(g.s[h]/g.n-mean[h])**2 : 0),0);
      if (ss[h]>0) w+=(h===0 ? 2 : 1)*between/ss[h];
    }
    metric.push(round(w));
  }
  return {center,scale,metric,means:Object.fromEntries(recallHeads.map((h,j)=>[h,round(mean[j])])),cases};
}
function calibrate(rows,model) {
  const raw=rows.map(r=>neighborPrediction(quantize(r.x,model),model)),y=rows.map(targets),n=rows.length;
  return Object.fromEntries(recallHeads.map((h,i)=>{
    const mean=y.reduce((s,a)=>s+a[i],0)/n,predictedMean=raw.reduce((s,a)=>s+a[i],0)/n;
    let xy=0,xx=0;
    for (let j=0;j<n;j++) {const dx=raw[j][i]-predictedMean;xy+=dx*(y[j][i]-mean);xx+=dx**2;}
    return [h,{mean:round(mean),predictedMean:round(predictedMean),slope:round(xx>1e-12 ? Math.max(0,Math.min(1.5,xy/xx)) : 0)}];
  }));
}
export function grid() {
  const rows=[{priorOnly:true,minWin:0,hurdle:0,lossPenalty:0}];
  for (const minWin of [.3,.4,.5]) for (const hurdle of [-2,0,2]) for (const lossPenalty of [0,.1]) {
    rows.push({priorOnly:false,minWin,hurdle,lossPenalty});
  }
  return rows;
}
function summary(sum,sq,n) {
  return {mean:round(sum/n),lowerSE:round(sum/n-Math.sqrt(Math.max(0,sq-sum**2/n)/(n*(n-1))))};
}
function select(start,model) {
  const settings=grid(),sums=settings.map(()=>({addedWins:0,addedTies:0,addedLosses:0,actualRescues:0,metrics:[0,0,0,0,0,0]}));
  let n=0,opportunities=0,winningSkips=0;
  visitWeeks(start,config.selectionCount,config.durations,frames=>{
    const bank=replay(frames),est=row=>row.e??=moveRecallEstimates(row.p,model);
    opportunities+=bank.skipped.length;winningSkips+=bank.skipped.filter(s=>s.net>0).length;
    let previousNet;
    settings.forEach((s,i)=>{
      const a=sums[i];
      for (const skip of bank.skipped) {
        if (!chooseMoveRecall(skip.row.p,est(skip.row),s).rescued) continue;
        if (skip.net>0) a.addedWins++;else if (skip.net===0) a.addedTies++;else a.addedLosses++;
      }
      let pos=[0,1],net=0,serv=0;
      for (let t=0;t<10;t++) {
        const row=bank.at(t,pos),p=chooseMoveRecall(row.p,est(row),s);
        const move=p.chosenId===row.p.shortId ? row.short : row.long;
        a.actualRescues+=Number(p.rescued);net+=move.net;serv+=move.served;pos=move.positions;
      }
      if (i===0) previousNet=net;
      const deltas=[net-bank.shortNet,serv-bank.shortService,net-previousNet];
      deltas.forEach((v,j)=>{a.metrics[2*j]+=v;a.metrics[2*j+1]+=v*v;});
    });
    n++;
  });
  const candidates=sums.map(({metrics,...rest},i)=>({settings:settings[i],...rest,netShort:summary(metrics[0],metrics[1],n),
    serviceShort:summary(metrics[2],metrics[3],n),netPrevious:summary(metrics[4],metrics[5],n)}));
  const feasible=candidates.filter(c=>c.addedWins>0 && c.netShort.lowerSE>0 && c.serviceShort.mean>=0 && c.netPrevious.mean>=0);
  const chosen=feasible.reduce((a,b)=>b.addedWins>a.addedWins || (a.addedWins===b.addedWins && b.netShort.lowerSE>a.netShort.lowerSE) ? b : a,candidates[0]);
  return {settings:chosen.settings,selection:{weeks:n,opportunities,winningSkips,feasible:feasible.length,candidates}};
}
function fit(seed) {
  const i=config.seeds.indexOf(seed);assert(i>=0,"Unregistered seed");
  const trainStart=config.base+i*config.stride,calibrationStart=trainStart+config.calibrationOffset,selectionStart=trainStart+config.selectionOffset;
  const train=collect(trainStart,config.fitCount),cal=collect(calibrationStart,config.calibrationCount);
  const model=fitMetric(train);model.calibration=calibrate(cal,model);
  return {format:"fleet-moverecall-neighbors-v1",seed,historicalHashes:hashes,trainStart,calibrationStart,selectionStart,
    fitWeeks:config.fitCount*11,calibrationWeeks:config.calibrationCount*11,fitExamples:train.length,calibrationExamples:cal.length,
    ...model,...select(selectionStart,model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,which]=process.argv.slice(2);assert(["--write","--check"].includes(mode));
  const dir=new URL("moverecall/",data);if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const seed of which===undefined ? config.seeds : [Number(which)]) {
    const m=fit(seed),file=new URL("fit-"+seed+".json",dir),text=JSON.stringify(m)+"\n";
    if (mode==="--write") writeFileSync(file,text);else assert.equal(readFileSync(file,"utf8"),text);
    console.log(mode,seed,m.fitExamples,m.calibrationExamples,m.settings);
  }
}
