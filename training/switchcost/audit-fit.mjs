// Independent of the switchcost fitter and decision code. Rebuild labels with
// recursive ordered-position suffixes, solve checks by gradients and replay each rule.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {visitWeeks} from "../longrepair/fit.mjs";
import {weights} from "../moverecall/fit.mjs";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {closureActions} from "../../docs/lib/closure-world.js";
import {moveRecallDecision,moveRecallProposal} from "../../docs/lib/moverecall-policy.js";

const data=new URL("../../docs/data/",import.meta.url),bytes=readFileSync(new URL("moverecall/fit-13.json",data));
const prior=JSON.parse(bytes),hashes={...prior.historicalHashes,recall:createHash("sha256").update(bytes).digest("hex")};
const seeds=[13,37,73,101,211],durations=[1,2,3,4,4,5,5],heads=["loss","win","downside","upside","service"];
const near=(a,b,tol=1e-8)=>assert(Math.abs(a-b)<tol,`${a} differs from ${b}`);
function analyze(frames) {
  const memo=frames.map(()=>({entries:[],oldValues:null}));
  function board(t,pos) {
    const b=memo[t],i=3*pos[0]+pos[1],f=frames[t];
    if (!b.entries[i]) {
      if (isClosureDecision(f.obs)) b.oldValues??=prepareClosureValues(f,weights.closure);
      const menu=closureActions({...f.obs,positions:pos}),p=moveRecallProposal(f,menu,weights,b.oldValues);
      const r=moveRecallDecision(p,prior),old=p.previous;
      const short=menu.find(a=>a.id===p.shortId),long=menu.find(a=>a.id===p.longId);
      const accepted=p.rescueEligible && r.chosenId===long.id;
      let x=null;
      if (p.rescueEligible) {
        const prev=[r.winProbability,r.expectedNet,r.expectedDownside,r.expectedService];
        x=[1,...prev,r.score,old.winProbability,old.expectedNet,(1-old.winProbability)*old.lossIfNonwin,old.expectedService,
          (9-t)/9,Math.max(0,t-f.obs.incident.start),...p.x.slice(-6),Number(accepted),...prev.map(v=>v*Number(accepted))];
      }
      b.entries[i]={x,accepted,short,long,incumbent:r.chosenId===short.id ? short : long};
    }
    return b.entries[i];
  }
  function tail(t,pos) {
    if (t===10) return [0,0];
    const r=board(t,pos);
    if (!r.tail) {const a=r.short,v=tail(t+1,a.positions);r.tail=[a.net+v[0],a.served+v[1]];}
    return r.tail;
  }
  const baseline=tail(0,[0,1]),cases=[];
  let pos=[0,1];
  frames.forEach((f,t)=>{
    const r=board(t,pos);
    if (r.x) {
      const v=tail(t+1,r.long.positions);
      cases.push({r,x:r.x,accepted:r.accepted,net:r.long.net+v[0]-r.tail[0],service:r.long.served+v[1]-r.tail[1]});
    }
    pos=r.short.positions;
  });
  return {baseline,board,cases};
}
function collect(start,n) {
  const out=[];
  visitWeeks(start,n,durations,frames=>{for(const {x,accepted,net,service} of analyze(frames).cases) out.push({x,accepted,net,service});});
  return out;
}
function counts(rows) {
  return {rows:rows.length,previousRescues:rows.filter(r=>r.accepted).length,losses:rows.filter(r=>r.net<0).length,
    ties:rows.filter(r=>r.net===0).length,wins:rows.filter(r=>r.net>0).length};
}
const target=r=>[Number(r.net<0),Number(r.net>0),Math.max(0,-r.net),Math.max(0,r.net),r.service];
const zFor=(x,m)=>x.map((v,j)=>j===0 ? 1 : (v-m.center[j])/m.scale[j]);
const raw=(z,m)=>heads.map(h=>z.reduce((s,v,j)=>s+v*m.heads[h][j],0));
function checkFit(rows,m) {
  const n=rows.length,d=rows[0].x.length;assert.equal(d,23);assert.deepEqual(counts(rows),m.fitExamples);
  for (let j=1;j<d;j++) {
    const mean=rows.reduce((s,r)=>s+r.x[j],0)/n,sd=Math.sqrt(rows.reduce((s,r)=>s+(r.x[j]-mean)**2,0)/n);
    near(m.center[j],mean);near(m.scale[j],sd>1e-8 ? sd : 1);
  }
  const gradients=heads.map(()=>new Float64Array(d));
  for (const row of rows) {
    const z=zFor(row.x,m),pred=raw(z,m),y=target(row);
    pred.forEach((v,k)=>z.forEach((f,j)=>{gradients[k][j]+=f*(y[k]-v);}));
  }
  let max=0;
  heads.forEach((h,i)=>m.heads[h].forEach((w,j)=>{max=Math.max(max,Math.abs(gradients[i][j]/n-(j ? .1*w : 0)));}));
  assert(max<1e-6,"Ridge normal equation "+max);return max;
}
function score(x,m) {
  const y=raw(zFor(x,m),m).map((v,j)=>{const c=m.calibration[heads[j]];return c.mean+c.slope*(v-c.predictedMean);});
  const [pl,pw]=y.slice(0,2).map(v=>Math.max(0,Math.min(1,v))),total=Math.max(1,pl+pw);
  return (Math.max(0,y[3])-Math.max(0,y[2]))+12*y[4]+6*(pw/total)-12*(pl/total);
}
function checkCal(rows,m) {
  const n=rows.length,pred=rows.map(r=>raw(zFor(r.x,m),m)),truth=rows.map(target);
  assert.deepEqual(counts(rows),m.calibrationExamples);
  heads.forEach((h,j)=>{
    const a=pred.reduce((s,v)=>s+v[j],0)/n,b=truth.reduce((s,v)=>s+v[j],0)/n;
    let xx=0,xy=0;pred.forEach((v,i)=>{const dx=v[j]-a;xx+=dx*dx;xy+=dx*(truth[i][j]-b);});
    const c=m.calibration[h];near(c.mean,b);near(c.predictedMean,a);near(c.slope,xx>1e-12 ? Math.max(0,Math.min(1.5,xy/xx)) : 0);
  });
  const by=[false,true].map(accepted=>rows.filter(r=>r.accepted===accepted).map(r=>score(r.x,m)).sort((a,b)=>a-b));
  const grid=[];
  for (const vetoFraction of [0,.05,.15,.30,.50]) for (const addFraction of [0,.05,.15,.35,.60]) {
    grid.push({vetoFraction,addFraction,vetoBelow:vetoFraction ? by[1][Math.ceil(by[1].length*vetoFraction)-1] : null,
      addAbove:addFraction ? by[0][Math.ceil(by[0].length*(1-addFraction))-1] : null});
  }
  assert.deepEqual(grid,m.selection.candidates.map(c=>c.settings));
}
function action(row,s,m) {
  if (!row.x) return 0;
  row.score??=score(row.x,m);
  if (row.accepted) return s.vetoFraction && row.score<s.vetoBelow ? -1 : 0;
  return s.addFraction && row.score>s.addAbove ? 1 : 0;
}
function checkSelection(m) {
  const candidates=m.selection.candidates,results=candidates.map(()=>({bins:[[0,0,0],[0,0,0]],vetoSavings:0,addedCredits:0,
    actual:[0,0],moments:new Float64Array(8)}));
  let n=0,pool=0;const old=[0,0,0];
  visitWeeks(m.selectionStart,8192,durations,frames=>{
    const {board,baseline,cases}=analyze(frames);pool+=cases.length;
    for (const r of cases) if (r.accepted) old[Math.sign(r.net)+1]++;
    const scores=candidates.map((candidate,i)=>{
      const {settings}=candidate,stat=results[i];let pos=[0,1],net=0,service=0;
      for(const r of cases) {
        const direction=action(r.r,settings,m);
        if (direction===0) continue;
        stat.bins[Number(direction>0)][Math.sign(r.net)+1]++;
        if (direction<0) stat.vetoSavings-=r.net;else stat.addedCredits+=r.net;
      }
      frames.forEach((_,t)=>{
        const row=board(t,pos),d=action(row,settings,m);
        const a=d===0 ? row.incumbent : d<0 ? row.short : row.long;
        if (d!==0) stat.actual[Number(d>0)]++;
        pos=a.positions;net+=a.net;service+=a.served;
      });
      return [net,service];
    });
    scores.forEach(([net,serv],i)=>[net-baseline[0],serv-baseline[1],net-scores[0][0],serv-scores[0][1]].forEach((v,j)=>{
      const x=results[i].moments;x[j*2]+=v;x[j*2+1]+=v*v;
    }));n++;
  });
  assert.equal(m.selection.weeks,n);assert.equal(m.selection.pool,pool);assert.deepEqual(old,[m.selection.oldLosses,m.selection.oldTies,m.selection.oldWins]);
  candidates.forEach((c,i)=>{
    const r=results[i];assert.deepEqual(r.bins,[[c.vetoedLosses,c.vetoedTies,c.vetoedWins],[c.addedLosses,c.addedTies,c.addedWins]]);
    assert.equal(r.vetoSavings,c.vetoSavings);assert.equal(r.addedCredits,c.addedCredits);assert.deepEqual(r.actual,[c.actualVetoes,c.actualAdds]);
    [c.netShort,c.serviceShort,c.netRecall,c.serviceRecall].forEach((v,j)=>{
      const sum=r.moments[j*2],ss=r.moments[j*2+1];near(v.mean,sum/n);near(v.lowerSE,sum/n-Math.sqrt(Math.max(0,ss-sum**2/n)/(n*(n-1))));
    });
  });
  const cut=c=>c.vetoedLosses-c.addedLosses;
  const feasible=candidates.filter(c=>cut(c)>0 && c.vetoSavings>0 && c.addedWins>=c.vetoedWins && c.serviceRecall.mean>=0 &&
    c.serviceShort.mean>=0 && c.netRecall.mean>0 && c.netShort.lowerSE>0);
  feasible.sort((a,b)=>cut(b)-cut(a) || b.netRecall.mean-a.netRecall.mean);
  assert.equal(feasible.length,m.selection.feasible);assert.deepEqual((feasible[0]??candidates[0]).settings,m.settings);
}
for (const seed of process.argv[2] ? [Number(process.argv[2])] : seeds) {
  assert(seeds.includes(seed));
  const m=JSON.parse(readFileSync(new URL("switchcost/fit-"+seed+".json",data)));assert.equal(m.seed,seed);
  assert.equal(m.format,"fleet-switchcost-two-sided-v1");assert.deepEqual(m.historicalHashes,hashes);
  assert.equal(m.trainStart,1000000000+1000000*seeds.indexOf(seed));assert.equal(m.calibrationStart,m.trainStart+250000);
  assert.equal(m.selectionStart,m.trainStart+500000);assert.equal(m.fitWeeks,180224);assert.equal(m.calibrationWeeks,45056);
  const residual=checkFit(collect(m.trainStart,16384),m);checkCal(collect(m.calibrationStart,4096),m);checkSelection(m);
  console.log("Audited",seed,m.fitExamples.rows,"editable Friday returns, five ridge heads and calibrations, 25 two-sided policies; max gradient",residual.toExponential(2));
}
