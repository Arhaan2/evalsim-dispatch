import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {costHeads,costProposalFromRecall,costRaw,costScore,switchCostEstimates,chooseSwitchCost} from "../../docs/lib/switchcost-policy.js";
import {replay,weights as preceding} from "../moverecall/fit.mjs";
import {visitWeeks} from "../longrepair/fit.mjs";
import {solveFleetRidge} from "../fleetweek/fit.mjs";

const data=new URL("../../docs/data/",import.meta.url),bytes=readFileSync(new URL("moverecall/fit-13.json",data));
const recallHash="5ce36c785708d82804810c462566d11a8092023bbb8598e241a7555963dadf7d";
assert.equal(createHash("sha256").update(bytes).digest("hex"),recallHash);
const recall=JSON.parse(bytes);
export const weights={...preceding,recall};
const hashes={...recall.historicalHashes,recall:recallHash};
export const config={seeds:[13,37,73,101,211],base:1000000000,stride:1000000,calOffset:250000,selOffset:500000,
  fitCount:16384,calCount:4096,selCount:8192,durations:[1,2,3,4,4,5,5],ridge:.10,
  veto:[0,.05,.15,.30,.50],add:[0,.05,.15,.35,.60]};
const round=v=>Number(v.toFixed(10));
const targets=row=>[Number(row.net<0),Number(row.net>0),Math.max(0,-row.net),Math.max(0,row.net),row.service];
function proposal(f,row) {return row.cost??=costProposalFromRecall(f,row.p,weights);}
function collect(start,count) {
  const out=[];
  visitWeeks(start,count,config.durations,frames=>{
    for (const {row,t,net,service} of replay(frames).skipped) {
      const p=proposal(frames[t],row);out.push({x:p.costX,prior:p.recallAccepted,net,service});
    }
  });
  return out;
}
function fitHeads(rows) {
  const n=rows.length,d=rows[0].x.length,center=Array(d).fill(0),scale=Array(d).fill(0);
  for (const row of rows) for (let j=1;j<d;j++) center[j]+=row.x[j]/n;
  for (const row of rows) for (let j=1;j<d;j++) scale[j]+=(row.x[j]-center[j])**2/n;
  for (let j=0;j<d;j++) {scale[j]=scale[j]>1e-16 ? round(Math.sqrt(scale[j])) : 1;center[j]=round(center[j]);}
  const gram=Array.from({length:d},()=>new Float64Array(d)),rhs=costHeads.map(()=>new Float64Array(d));
  for (const r of rows) {
    const z=r.x.map((v,j)=>(v-center[j])/scale[j]),y=targets(r);
    for (let j=0;j<d;j++) {
      for (let k=0;k<=j;k++) gram[j][k]+=z[j]*z[k];
      for (let h=0;h<5;h++) rhs[h][j]+=z[j]*y[h];
    }
  }
  const solved=solveFleetRidge(gram,rhs,n,config.ridge);
  return {center,scale,heads:Object.fromEntries(costHeads.map((h,j)=>[h,solved[j]]))};
}
function calibrate(rows,model) {
  const raw=rows.map(r=>costRaw(r.x,model)),y=rows.map(targets),n=rows.length;
  return Object.fromEntries(costHeads.map((h,k)=>{
    const mean=y.reduce((s,v)=>s+v[k],0)/n,predictedMean=raw.reduce((s,v)=>s+v[k],0)/n;
    let xy=0,xx=0;
    for (let i=0;i<n;i++) {const dx=raw[i][k]-predictedMean;xy+=dx*(y[i][k]-mean);xx+=dx*dx;}
    return [h,{mean:round(mean),predictedMean:round(predictedMean),slope:round(xx>1e-12 ? Math.max(0,Math.min(1.5,xy/xx)) : 0)}];
  }));
}
export function thresholdGrid(rows,model) {
  const groups=[[],[]];
  for (const r of rows) groups[Number(r.prior)].push(costScore(switchCostEstimates({rescueEligible:true,costX:r.x},model)));
  groups.forEach(g=>{assert(g.length>0);g.sort((a,b)=>a-b);});
  const quant=(g,p)=>g[Math.ceil(p*g.length)-1];
  const out=[];
  for (const vetoFraction of config.veto) for (const addFraction of config.add) {
    out.push({vetoFraction,addFraction,vetoBelow:vetoFraction>0 ? quant(groups[1],vetoFraction) : null,
      addAbove:addFraction>0 ? quant(groups[0],1-addFraction) : null});
  }
  return out;
}
export function chooseCandidate(candidates) {
  const reduced=c=>c.vetoedLosses-c.addedLosses;
  const feasible=candidates.filter(c=>reduced(c)>0 && c.vetoSavings>0 && c.addedWins>=c.vetoedWins &&
    c.serviceRecall.mean>=0 && c.serviceShort.mean>=0 && c.netRecall.mean>0 && c.netShort.lowerSE>0);
  const chosen=feasible.reduce((a,b)=>reduced(b)>reduced(a) || (reduced(b)===reduced(a) && b.netRecall.mean>a.netRecall.mean) ? b : a,candidates[0]);
  return {settings:chosen.settings,feasible:feasible.length};
}
const summary=(sum,ss,n)=>({mean:round(sum/n),lowerSE:round(sum/n-Math.sqrt(Math.max(0,ss-sum**2/n)/(n*(n-1))))});
function select(start,grid,model) {
  const sums=grid.map(()=>({vetoedWins:0,vetoedTies:0,vetoedLosses:0,addedWins:0,addedTies:0,addedLosses:0,
    vetoSavings:0,addedCredits:0,actualVetoes:0,actualAdds:0,metrics:new Float64Array(8)}));
  let weeks=0,oldWins=0,oldTies=0,oldLosses=0,pool=0;
  visitWeeks(start,config.selCount,config.durations,frames=>{
    const bank=replay(frames);
    const decide=(row,t,s)=>{
      const p=proposal(frames[t],row);row.ce??=switchCostEstimates(p,model);return chooseSwitchCost(p,row.ce,s);
    };
    for (const {row,t,net} of bank.skipped) {
      pool++;
      if (!proposal(frames[t],row).recallAccepted) continue;
      if (net>0) oldWins++;else if (net<0) oldLosses++;else oldTies++;
    }
    let oldNet,oldService;
    grid.forEach((s,i)=>{
      const r=sums[i];
      for (const {row,t,net} of bank.skipped) {
        const d=decide(row,t,s);
        if (d.vetoed) {
          if (net>0) r.vetoedWins++;else if (net<0) r.vetoedLosses++;else r.vetoedTies++;
          r.vetoSavings-=net;
        }
        if (d.added) {
          if (net>0) r.addedWins++;else if (net<0) r.addedLosses++;else r.addedTies++;
          r.addedCredits+=net;
        }
      }
      let pos=[0,1],net=0,served=0;
      for (let t=0;t<10;t++) {
        const row=bank.at(t,pos),d=decide(row,t,s),a=d.chosenId===row.p.shortId ? row.short : row.long;
        r.actualVetoes+=Number(d.vetoed);r.actualAdds+=Number(d.added);net+=a.net;served+=a.served;pos=a.positions;
      }
      if (i===0) {oldNet=net;oldService=served;}
      [net-bank.shortNet,served-bank.shortService,net-oldNet,served-oldService].forEach((v,k)=>{
        r.metrics[2*k]+=v;r.metrics[2*k+1]+=v*v;
      });
    });weeks++;
  });
  const candidates=sums.map(({metrics,...rest},i)=>({settings:grid[i],...rest,netShort:summary(metrics[0],metrics[1],weeks),
    serviceShort:summary(metrics[2],metrics[3],weeks),netRecall:summary(metrics[4],metrics[5],weeks),serviceRecall:summary(metrics[6],metrics[7],weeks)}));
  const {settings,feasible}=chooseCandidate(candidates);
  return {settings,selection:{weeks,pool,oldWins,oldTies,oldLosses,feasible,candidates}};
}
function counts(rows) {
  return {rows:rows.length,previousRescues:rows.filter(r=>r.prior).length,losses:rows.filter(r=>r.net<0).length,
    ties:rows.filter(r=>r.net===0).length,wins:rows.filter(r=>r.net>0).length};
}
function fit(seed) {
  const i=config.seeds.indexOf(seed);assert(i>=0);
  const trainStart=config.base+i*config.stride,calibrationStart=trainStart+config.calOffset,selectionStart=trainStart+config.selOffset;
  const train=collect(trainStart,config.fitCount),cal=collect(calibrationStart,config.calCount);
  const model=fitHeads(train);model.calibration=calibrate(cal,model);
  return {format:"fleet-switchcost-two-sided-v1",seed,historicalHashes:hashes,trainStart,calibrationStart,selectionStart,
    fitWeeks:11*config.fitCount,calibrationWeeks:11*config.calCount,fitExamples:counts(train),calibrationExamples:counts(cal),
    ...model,...select(selectionStart,thresholdGrid(cal,model),model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,which]=process.argv.slice(2);assert(["--write","--check"].includes(mode));
  const dir=new URL("switchcost/",data);if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const seed of which===undefined ? config.seeds : [Number(which)]) {
    const m=fit(seed),file=new URL("fit-"+seed+".json",dir),text=JSON.stringify(m)+"\n";
    if (mode==="--write") writeFileSync(file,text);else assert.equal(readFileSync(file,"utf8"),text);
    console.log(mode,seed,m.fitExamples,m.settings);
  }
}
