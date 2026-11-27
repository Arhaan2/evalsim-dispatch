// Independent short-policy suffix recursion, exhaustive neighbor sorting and
// full candidate trajectories check the archive. Do not import the fitter.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {FLEET_FAMILIES} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureActions,closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {longMoveProposal,longMoveDecision} from "../../docs/lib/longmove-policy.js";

const data=new URL("../../docs/data/",import.meta.url),seeds=[13,37,73,101,211],families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
const paths={override:"override/model-13",uncertainty:"uncertainty/model-13",closure:"closure/model-13",
  short:"longrepair/short-13",long:"longrepair/fit-13",previous:"longmove/fit-13"};
const weights={},digests={};
for(const [k,file] of Object.entries(paths)) {
  const bytes=readFileSync(new URL(file+".json",data));weights[k]=JSON.parse(bytes);digests[k]=createHash("sha256").update(bytes).digest("hex");
}
const heads=["win","net","downside","service"];
const near=(a,b,tol=1e-8)=>assert(Math.abs(a-b)<tol,`${a} differs from ${b}`);
function weeks(start,n,visit) {
  families.forEach((family,f)=>{
    for (let k=0;k<n;k++) {
      const obs=closureFrames({family,seed:start+f*n+k,closure:{starts:[2,4,6],durations:[1,2,3,4,4,5,5]}});
      visit(obs.map(o=>({f:closureFrame(o),positions:new Map(),prepared:null})));
    }
  });
}
function at(frames,t,pos) {
  const b=frames[t],i=pos.join("/");
  if (!b.positions.has(i)) {
    const {f}=b,menu=closureActions({...f.obs,positions:pos});
    if (isClosureDecision(f.obs)) b.prepared??=prepareClosureValues(f,weights.closure);
    const p=longMoveProposal(f,menu,weights,b.prepared),h=longMoveDecision(p,weights.previous);
    const short=menu.find(a=>a.id===p.shortId),long=menu.find(a=>a.id===p.longId);
    const x=p.eligible && h.chosenId===p.shortId ? [...p.x.slice(1),h.winProbability,h.expectedNet,(1-h.winProbability)*h.lossIfNonwin,h.expectedService] : null;
    b.positions.set(i,{x,short,long,previous:h.chosenId===short.id ? short : long});
  }
  return b.positions.get(i);
}
function labels(frames) {
  function suffix(t,pos) {
    if (t===10) return [0,0];
    const row=at(frames,t,pos);
    if (!row.tail) {const a=row.short,v=suffix(t+1,a.positions);row.tail=[v[0]+a.net,v[1]+a.served];}
    return row.tail;
  }
  const source=suffix(0,[0,1]),skips=[];
  let pos=[0,1];
  frames.forEach((_,t)=>{
    const row=at(frames,t,pos);
    if (row.x) {
      const b=suffix(t+1,row.long.positions);
      skips.push({row,x:row.x,net:row.long.net+b[0]-row.tail[0],service:row.long.served+b[1]-row.tail[1]});
    }
    pos=row.short.positions;
  });
  return {source,skips};
}
const four=r=>[Number(r.net>0),r.net,Math.max(0,-r.net),r.service];
const quant=(r,m)=>r.x.map((v,j)=>Math.round(Math.min(128,Math.max(-128,32*(v-m.center[j])/m.scale[j]))) || 0);
function collect(start,n) {
  const out=[];
  weeks(start,n,f=>{for(const {x,net,service} of labels(f).skips) out.push({x,net,service});});
  return out;
}
function auditMetric(m,train) {
  const n=train.length,d=train[0].x.length;assert.equal(d,58);assert.equal(n,m.fitExamples);
  assert.equal(m.cases.length,n);assert.equal(m.metric.length,d);
  const y=train.map(four),means=heads.map((_,k)=>y.reduce((s,r)=>s+r[k],0)/n),varY=means.map((mean,k)=>y.reduce((s,r)=>s+(r[k]-mean)**2,0));
  heads.forEach((h,k)=>near(m.means[h],means[k]));
  for (let j=0;j<d;j++) {
    const mean=train.reduce((s,r)=>s+r.x[j],0)/n;
    const sd=Math.sqrt(train.reduce((s,r)=>s+(r.x[j]-mean)**2,0)/n);
    near(m.center[j],mean);near(m.scale[j],sd>1e-8 ? sd : 1);
  }
  train.forEach((r,i)=>assert.deepEqual(m.cases[i],{x:quant(r,m),net:r.net,service:r.service}));
  for (let j=0;j<d;j++) {
    const sorted=m.cases.map((r,i)=>({v:r.x[j],i})).sort((a,b)=>a.v-b.v);
    const cuts=[...new Set(Array.from({length:7},(_,k)=>sorted[Math.floor(n*(k+1)/8)-1].v))];
    cuts.push(Infinity);
    let start=0,w=.02;
    for (const cut of cuts) {
      let end=start;
      while (end<n && sorted[end].v<=cut) end++;
      if (end===start) continue;
      for (let k=0;k<4;k++) {
        let sum=0;
        for (let i=start;i<end;i++) sum+=y[sorted[i].i][k];
        if (varY[k]>0) w+=(k===0 ? 2 : 1)*(end-start)*(sum/(end-start)-means[k])**2/varY[k];
      }
      start=end;
    }
    near(m.metric[j],w);
  }
}
// Exhaustively compute all distances, then sort by distance and original row
// number. The fitted implementation maintains a truncated list with early exits.
function predict(x,m) {
  const q=quant({x},m),nearest=m.cases.map((r,i)=>{
    let d=0;for (let j=0;j<q.length;j++) d+=m.metric[j]*(r.x[j]-q[j])**2;
    return {i,d};
  }).sort((a,b)=>a.d-b.d || a.i-b.i).slice(0,64);
  const sum=heads.map(h=>16*m.means[h]);
  for (const {i} of nearest) four(m.cases[i]).forEach((v,k)=>{sum[k]+=v;});
  return sum.map(s=>s/(16+nearest.length));
}
function auditCal(m,rows) {
  const n=rows.length;assert.equal(n,m.calibrationExamples);
  const x=rows.map(r=>predict(r.x,m)),y=rows.map(four);
  for (const [k,h] of heads.entries()) {
    const mx=x.reduce((s,v)=>s+v[k],0)/n,my=y.reduce((s,v)=>s+v[k],0)/n;
    let v=0,cov=0;
    for (let i=0;i<n;i++) {const dx=x[i][k]-mx;v+=dx**2;cov+=dx*(y[i][k]-my);}
    const c=m.calibration[h];near(c.mean,my);near(c.predictedMean,mx);
    near(c.slope,v>1e-12 ? Math.max(0,Math.min(1.5,cov/v)) : 0);
  }
}
function rescued(row,s,m) {
  if (!row.x || s.priorOnly) return false;
  row.est??=predict(row.x,m).map((v,k)=>{const c=m.calibration[heads[k]];return c.mean+c.slope*(v-c.predictedMean);});
  const [p,net,loss,serv]=row.est;
  return Math.max(.005,Math.min(.995,p))>=s.minWin && net+12*serv-s.lossPenalty*Math.max(0,loss)>s.hurdle;
}
function auditSelect(m) {
  const grid=[{priorOnly:true,minWin:0,hurdle:0,lossPenalty:0}];
  for(const minWin of [.3,.4,.5]) for (const hurdle of [-2,0,2]) for(const lossPenalty of [0,.1]) grid.push({priorOnly:false,minWin,hurdle,lossPenalty});
  const cand=m.selection.candidates;assert.deepEqual(grid,cand.map(c=>c.settings));
  const sums=grid.map(()=>({scores:[0,0,0,0,0,0],added:[0,0,0],actual:0}));
  let count=0,opportunities=0,wins=0;
  weeks(m.selectionStart,8192,frames=>{
    const {source,skips}=labels(frames);opportunities+=skips.length;wins+=skips.filter(s=>s.net>0).length;
    const ledgers=grid.map((s,i)=>{
      const r=sums[i];
      for(const skip of skips) if (rescued(skip.row,s,m)) r.added[Math.sign(skip.net)+1]++;
      let pos=[0,1],net=0,serv=0;
      frames.forEach((_,t)=>{
        const row=at(frames,t,pos),accept=rescued(row,s,m),a=accept ? row.long : row.previous;
        r.actual+=Number(accept);net+=a.net;serv+=a.served;pos=a.positions;
      });
      return [net,serv];
    });
    ledgers.forEach(([net,serv],i)=>{
      [net-source[0],serv-source[1],net-ledgers[0][0]].forEach((v,k)=>{sums[i].scores[k*2]+=v;sums[i].scores[k*2+1]+=v*v;});
    });count++;
  });
  assert.equal(count,m.selection.weeks);assert.equal(wins,m.selection.winningSkips);assert.equal(opportunities,m.selection.opportunities);
  cand.forEach((c,i)=>{
    const r=sums[i];assert.deepEqual(r.added,[c.addedLosses,c.addedTies,c.addedWins]);assert.equal(r.actual,c.actualRescues);
    [c.netShort,c.serviceShort,c.netPrevious].forEach((v,j)=>{
      const sum=r.scores[2*j],mean=sum/count;near(v.mean,mean);
      near(v.lowerSE,mean-Math.sqrt(Math.max(0,r.scores[2*j+1]-sum**2/count)/(count*(count-1))));
    });
  });
  const feasible=cand.filter(c=>c.addedWins>0 && c.netShort.lowerSE>0 && c.serviceShort.mean>=0 && c.netPrevious.mean>=0);
  assert.equal(feasible.length,m.selection.feasible);
  const ranked=feasible.slice().sort((a,b)=>b.addedWins-a.addedWins || b.netShort.lowerSE-a.netShort.lowerSE);
  assert.deepEqual(m.settings,(ranked[0]??cand[0]).settings);
}
for(const seed of process.argv[2] ? [Number(process.argv[2])] : seeds) {
  assert(seeds.includes(seed));
  const m=JSON.parse(readFileSync(new URL("moverecall/fit-"+seed+".json",data)));
  assert.equal(m.seed,seed);assert.equal(m.format,"fleet-moverecall-neighbors-v1");assert.deepEqual(m.historicalHashes,digests);
  assert.equal(m.trainStart,900000000+seeds.indexOf(seed)*1000000);assert.equal(m.calibrationStart,m.trainStart+250000);assert.equal(m.selectionStart,m.trainStart+500000);
  assert.equal(m.fitWeeks,180224);assert.equal(m.calibrationWeeks,45056);
  auditMetric(m,collect(m.trainStart,16384));auditCal(m,collect(m.calibrationStart,4096));auditSelect(m);
  console.log("Audited",seed,m.fitExamples,"actual old-skipped cases,",m.calibrationExamples,"independently sorted neighbor predictions, 19 full-week candidates and the capture guard.");
}
