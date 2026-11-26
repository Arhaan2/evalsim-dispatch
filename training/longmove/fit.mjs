import assert from "node:assert/strict";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {closureActions} from "../../docs/lib/closure-world.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {chooseLongMove,headNames,longMoveEstimates,longMoveProposal,rawHead,treeValue} from "../../docs/lib/longmove-policy.js";
import {digests,weights} from "../shortdefault/fit.mjs";
import {ordered,visitWeeks} from "../longrepair/fit.mjs";

export const config={seeds:[13,37,73,101,211],start:800000000,stride:1000000,calOffset:200000,selOffset:400000,
  fitCount:8192,calCount:2048,selCount:4096,durations:[1,2,3,4,4,5,5],rounds:32,depth:2,rate:.12,
  minRows:24,onPathWeight:8,minWins:[0,.4,.55],hurdles:[0,2,5],serviceCredits:[0,12]};
const round=x=>Number(x.toFixed(10));
const posIndex=pos=>3*pos[0]+pos[1];

export function tapeExamples(frames,visit) {
  let net=new Float64Array(9),served=new Float64Array(9);
  const tape=new Array(10);
  for (let t=9;t>=0;t--) {
    const f=frames[t],prepared=isClosureDecision(f.obs) ? prepareClosureValues(f,weights.closure) : null;
    const nextNet=new Float64Array(9),nextServed=new Float64Array(9);
    tape[t]=ordered.map((from,i)=>{
      const menu=closureActions({...f.obs,positions:from}),p=longMoveProposal(f,menu,weights,prepared);
      const s=menu.find(a=>a.id===p.shortId),to=posIndex(s.positions);
      nextNet[i]=s.net+net[to];nextServed[i]=s.served+served[to];
      if (!p.eligible) return {to};
      const l=menu.find(a=>a.id===p.longId),dest=posIndex(l.positions);
      return {to,x:p.x,net:l.net+net[dest]-nextNet[i],service:l.served+served[dest]-nextServed[i]};
    });
    net=nextNet;served=nextServed;
  }
  let pos=posIndex([0,1]);
  for (const [t,board] of tape.entries()) {
    for (const [i,row] of board.entries()) {
      const [a,b]=ordered[i],onPath=pos===i;
      const weight=Number(a<=b)+config.onPathWeight*Number(onPath);
      if (row.x && weight) visit({x:row.x,net:row.net,service:row.service,weight,onPath},t,i);
    }
    pos=board[pos].to;
  }
}
function collect(start,n) {
  const rows=[];
  visitWeeks(start,n,config.durations,frames=>tapeExamples(frames,row=>rows.push(row)));
  return rows;
}
const target=(r,name)=>name==="win" ? Number(r.net>0) : name==="gain" ? r.net : name==="downside" ? -r.net : r.service;
const selected=(r,name)=>name==="gain" ? r.net>0 : name==="downside" ? r.net<=0 : true;
function headRows(rows,name) {return rows.filter(r=>selected(r,name));}
function stats(rows) {
  return {rows:rows.length,onPath:rows.filter(r=>r.onPath).length,weight:rows.reduce((s,r)=>s+r.weight,0),
    wins:rows.filter(r=>r.net>0).length,ties:rows.filter(r=>r.net===0).length};
}

function makeBins(rows) {
  const n=rows.length,d=rows[0].x.length,cuts=[],bins=[];
  for (let j=0;j<d;j++) {
    const sorted=rows.map(r=>r.x[j]).sort((a,b)=>a-b), thresholds=new Set();
    for (let k=1;k<16;k++) {
      const cut=sorted[Math.max(0,Math.floor(n*k/16)-1)];
      if (cut<sorted[n-1]) thresholds.add(cut);
    }
    const cs=[...thresholds];
    cuts.push(cs);
    bins.push(Uint8Array.from(rows,r=>{
      let b=0;
      while (b<cs.length && r.x[j]>cs[b]) b++;
      return b;
    }));
  }
  return {cuts,bins};
}
// Each split maximizes weighted squared-error reduction. Occupancy is counted
// in distinct observed placements, so one frequently weighted board cannot make a leaf.
function grow(ids,depth,rows,residual,quantiles) {
  const {bins,cuts}=quantiles;
  let sum=0,total=0;
  for (const i of ids) {sum+=rows[i].weight*residual[i];total+=rows[i].weight;}
  const leaf=()=>({value:round(sum/total)});
  if (depth===0 || ids.length<2*config.minRows) return leaf();
  let best=null,bestGain=1e-9;
  for (let j=1;j<cuts.length;j++) {
    const cs=cuts[j];
    if (!cs.length) continue;
    const n=new Uint32Array(cs.length+1),w=new Float64Array(cs.length+1),y=new Float64Array(cs.length+1);
    for (const i of ids) {
      const k=bins[j][i];n[k]++;w[k]+=rows[i].weight;y[k]+=rows[i].weight*residual[i];
    }
    let leftN=0,leftW=0,leftY=0;
    for (let k=0;k<cs.length;k++) {
      leftN+=n[k];leftW+=w[k];leftY+=y[k];
      if (leftN<config.minRows || ids.length-leftN<config.minRows) continue;
      const gain=leftY**2/leftW+(sum-leftY)**2/(total-leftW)-sum**2/total;
      if (gain>bestGain+1e-9) {bestGain=gain;best={feature:j,cut:cs[k]};}
    }
  }
  if (!best) return leaf();
  const left=[],right=[];
  for (const i of ids) (rows[i].x[best.feature]<=best.cut ? left : right).push(i);
  return {...best,left:grow(left,depth-1,rows,residual,quantiles),right:grow(right,depth-1,rows,residual,quantiles)};
}
export function boost(rows,name) {
  const used=headRows(rows,name),total=used.reduce((s,r)=>s+r.weight,0);
  assert(used.length>=2*config.minRows,"Too few unique disagreements for "+name);
  const base=round(used.reduce((s,r)=>s+r.weight*target(r,name),0)/total);
  const ids=used.map((_,i)=>i),residual=used.map(r=>target(r,name)-base),q=makeBins(used);
  const trees=[];
  for (let k=0;k<config.rounds;k++) {
    const tree=grow(ids,config.depth,used,residual,q);
    trees.push(tree);
    for (const i of ids) residual[i]-=config.rate*treeValue(tree,used[i].x);
  }
  return {base,rate:config.rate,trees,rows:used.length,weight:total};
}
function calibrate(rows,heads) {
  const out={};
  for (const name of headNames) {
    const used=headRows(rows,name),raw=used.map(r=>rawHead(heads[name],r.x));
    const total=used.reduce((s,r)=>s+r.weight,0),mean=used.reduce((s,r)=>s+r.weight*target(r,name),0)/total;
    const predictedMean=used.reduce((s,r,i)=>s+r.weight*raw[i],0)/total;
    let xy=0,xx=0;
    used.forEach((r,i)=>{const dx=raw[i]-predictedMean;xy+=r.weight*dx*(target(r,name)-mean);xx+=r.weight*dx*dx;});
    out[name]={rows:used.length,weight:total,mean:round(mean),predictedMean:round(predictedMean),
      slope:round(xx>1e-12 ? Math.max(0,Math.min(1.5,xy/xx)) : 0)};
  }
  return out;
}
export function settingsGrid() {
  const out=[{shortOnly:true,minWin:0,hurdle:0,serviceCredit:0}];
  for (const minWin of config.minWins) for (const hurdle of config.hurdles) for (const serviceCredit of config.serviceCredits) {
    out.push({shortOnly:false,minWin,hurdle,serviceCredit});
  }
  return out;
}
const summary=(s,ss,n)=>({mean:round(s/n),lowerSE:round(s/n-Math.sqrt(Math.max(0,ss-s*s/n)/(n*(n-1))))});
function select(start,model) {
  const grid=settingsGrid(),stats=grid.map(()=>({switches:0,net:0,ss:0,service:0,serviceSS:0}));
  let n=0;
  visitWeeks(start,config.selCount,config.durations,frames=>{
    const memo=frames.map(()=>({positions:[],prepared:null}));
    function lookup(t,pos) {
      const i=posIndex(pos),m=memo[t],f=frames[t];
      if (!m.positions[i]) {
        if (isClosureDecision(f.obs)) m.prepared??=prepareClosureValues(f,weights.closure);
        const menu=closureActions({...f.obs,positions:pos}),p=longMoveProposal(f,menu,weights,m.prepared);
        m.positions[i]={menu,p,e:longMoveEstimates(p,model)};
      }
      return m.positions[i];
    }
    let defaultNet,defaultService;
    grid.forEach((s,i)=>{
      const row=stats[i];let net=0,service=0,pos=[0,1];
      for (let t=0;t<10;t++) {
        const {menu,p,e}=lookup(t,pos),id=chooseLongMove(p,e,s).chosenId;
        const a=menu.find(action=>action.id===id);
        if (id!==p.shortId) row.switches++;
        net+=a.net;service+=a.served;pos=a.positions;
      }
      if (i===0) {defaultNet=net;defaultService=service;}
      const u=net-defaultNet,v=service-defaultService;
      row.net+=u;row.ss+=u*u;row.service+=v;row.serviceSS+=v*v;
    });
    n++;
  });
  const candidates=stats.map((r,i)=>({settings:grid[i],switches:r.switches,netShort:summary(r.net,r.ss,n),
    serviceShort:summary(r.service,r.serviceSS,n)}));
  const feasible=candidates.filter(c=>c.netShort.lowerSE>0 && c.serviceShort.mean>=0);
  const chosen=feasible.reduce((a,b)=>b.netShort.lowerSE>a.netShort.lowerSE ? b : a,candidates[0]);
  return {settings:chosen.settings,selection:{weeks:n,feasible:feasible.length,candidates}};
}
function fit(seed) {
  const i=config.seeds.indexOf(seed);assert(i>=0);
  const trainStart=config.start+i*config.stride,calibrationStart=trainStart+config.calOffset,selectionStart=trainStart+config.selOffset;
  const train=collect(trainStart,config.fitCount),cal=collect(calibrationStart,config.calCount);
  const heads=Object.fromEntries(headNames.map(name=>[name,boost(train,name)]));
  const model={heads,calibration:calibrate(cal,heads)};
  return {format:"fleet-longmove-boost-v1",seed,historicalHashes:digests,trainStart,calibrationStart,selectionStart,
    fitWeeks:config.fitCount*11,calibrationWeeks:config.calCount*11,fitExamples:stats(train),calibrationExamples:stats(cal),
    ...model,...select(selectionStart,model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,which]=process.argv.slice(2);assert(["--write","--check"].includes(mode),"Choose --write or --check");
  const dir=new URL("../../docs/data/longmove/",import.meta.url);if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const seed of which===undefined ? config.seeds : [Number(which)]) {
    const m=fit(seed),text=JSON.stringify(m)+"\n",file=new URL("fit-"+seed+".json",dir);
    if (mode==="--write") writeFileSync(file,text);else assert.equal(readFileSync(file,"utf8"),text,"Checkpoint mismatch");
    console.log(mode,seed,m.fitExamples,m.settings);
  }
}
