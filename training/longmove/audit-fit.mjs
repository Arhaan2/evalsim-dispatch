// Forward dispatch and an independent scan of quantile-ordered rows verify the
// counterfactual labels, weighted CART growth, calibration and selection.
// The audit never imports the fitting module.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {FLEET_FAMILIES} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {closureActions,closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {longMoveProposal} from "../../docs/lib/longmove-policy.js";

const data=new URL("../../docs/data/",import.meta.url),seeds=[13,37,73,101,211],families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
const files={override:"override/model-13",uncertainty:"uncertainty/model-13",closure:"closure/model-13",
  short:"longrepair/short-13",long:"longrepair/fit-13"};
const weights={},hashes={};
for (const [name,path] of Object.entries(files)) {
  const bytes=readFileSync(new URL(path+".json",data));weights[name]=JSON.parse(bytes);
  hashes[name]=createHash("sha256").update(bytes).digest("hex");
}
const names=["win","gain","downside","service"];
const near=(a,b,tol=1e-8)=>assert(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
function visitWeeks(start,n,fn) {
  families.forEach((family,f)=>{
    for (let k=0;k<n;k++) {
      const frames=closureFrames({family,seed:start+f*n+k,closure:{starts:[2,4,6],durations:[1,2,3,4,4,5,5]}});
      fn(frames.map(obs=>({frame:closureFrame(obs),pos:[],prepared:null})));
    }
  });
}
const index=pos=>3*pos[0]+pos[1];
function entry(board,pos) {
  const i=index(pos);
  if (!board.pos[i]) {
    const f=board.frame,menu=closureActions({...f.obs,positions:pos});
    if (isClosureDecision(f.obs)) board.prepared??=prepareClosureValues(f,weights.closure);
    const p=longMoveProposal(f,menu,weights,board.prepared);
    board.pos[i]={p,short:menu.find(a=>a.id===p.shortId),long:menu.find(a=>a.id===p.longId)};
  }
  return board.pos[i];
}
function friday(frames,t,initial) {
  let pos=initial.positions,net=initial.net,service=initial.served;
  for (let k=t+1;k<10;k++) {
    const a=entry(frames[k],pos).short;net+=a.net;service+=a.served;pos=a.positions;
  }
  return [net,service];
}
function collect(start,n) {
  const rows=[];
  visitWeeks(start,n,frames=>{
    let actual=[0,1];
    frames.forEach((board,t)=>{
      if (isClosureDecision(board.frame.obs)) {
        for (let a=0;a<3;a++) for (let b=0;b<3;b++) {
          const onPath=actual[0]===a && actual[1]===b,weight=(a<=b ? 1 : 0)+(onPath ? 8 : 0);
          if (!weight) continue;
          const {p,short,long}=entry(board,[a,b]);
          if (!p.eligible) continue;
          const s=friday(frames,t,short),l=friday(frames,t,long);
          rows.push({x:p.x,onPath,weight,net:l[0]-s[0],service:l[1]-s[1]});
        }
      }
      actual=entry(board,actual).short.positions;
    });
  });
  return rows;
}
function counts(rows) {
  return {rows:rows.length,onPath:rows.filter(r=>r.onPath).length,weight:rows.reduce((s,r)=>s+r.weight,0),
    wins:rows.filter(r=>r.net>0).length,ties:rows.filter(r=>r.net===0).length};
}
function targets(rows,name) {
  return rows.filter(r=>name==="gain" ? r.net>0 : name==="downside" ? r.net<=0 : true).map(r=>({...r,
    y:name==="gain" ? r.net : name==="downside" ? -r.net : name==="service" ? r.service : Number(r.net>0)}));
}
function predictTree(node,x) {
  if ("value" in node) return node.value;
  return predictTree(x[node.feature]<=node.cut ? node.left : node.right,x);
}
const predict=(head,x)=>head.trees.reduce((s,node)=>s+head.rate*predictTree(node,x),head.base);
function auditTrees(rows,head) {
  near(head.rate,.12);assert.equal(head.trees.length,32);assert.equal(rows.length,head.rows);
  const total=rows.reduce((s,r)=>s+r.weight,0);assert.equal(total,head.weight);
  near(head.base,rows.reduce((s,r)=>s+r.weight*r.y,0)/total);
  const ids=rows.map((r,i)=>i),res=rows.map(r=>r.y-head.base),d=rows[0].x.length;
  assert.equal(d,55);
  const sorted=Array.from({length:d},(_,j)=>ids.slice().sort((a,b)=>rows[a].x[j]-rows[b].x[j]));
  const boundaries=sorted.map((order,j)=>{
    const vals=order.map(i=>rows[i].x[j]),cuts=new Set();
    for (let k=1;k<=15;k++) {
      const v=vals[Math.max(0,Math.floor(k*order.length/16)-1)];
      if (v<vals.at(-1)) cuts.add(v);
    }
    return [...cuts];
  });
  let maxLeafError=0,checked=0;
  function inspect(node,group,depth) {
    let w=0,sum=0;
    for (const i of group) {w+=rows[i].weight;sum+=rows[i].weight*res[i];}
    const leaf=Object.hasOwn(node,"value");
    if (leaf) {const err=Math.abs(node.value-sum/w);maxLeafError=Math.max(maxLeafError,err);assert(err<1e-8);}
    if (depth===0 || group.length<48) {assert(leaf);return;}
    const active=new Uint8Array(rows.length);
    for (const i of group) active[i]=1;
    let best=0,chosen=null;
    for (let j=1;j<d;j++) {
      const order=sorted[j];
      let k=0,leftN=0,leftW=0,leftSum=0;
      for (const cut of boundaries[j]) {
        while (k<order.length && rows[order[k]].x[j]<=cut) {
          const i=order[k++];
          if (active[i]) {leftN++;leftW+=rows[i].weight;leftSum+=rows[i].weight*res[i];}
        }
        if (leftN<24 || group.length-leftN<24) continue;
        const rightW=w-leftW;
        const gain=leftW*rightW/w*(leftSum/leftW-(sum-leftSum)/rightW)**2;
        best=Math.max(best,gain);
        if (!leaf && j===node.feature && cut===node.cut) chosen=gain;
      }
    }
    if (leaf) {assert(best<1e-7,"Missing gainful split "+best);return;}
    assert.notEqual(chosen,null,"Nonregistered tree cut");
    near(chosen,best,1e-7+best*1e-10);checked++;
    const left=[],right=[];
    for (const i of group) (rows[i].x[node.feature]<=node.cut ? left : right).push(i);
    inspect(node.left,left,depth-1);inspect(node.right,right,depth-1);
  }
  for (const node of head.trees) {
    inspect(node,ids,2);
    for (const i of ids) res[i]-=.12*predictTree(node,rows[i].x);
  }
  return {maxLeafError,checked};
}
function calibration(rows,head,cal) {
  const raw=rows.map(r=>predict(head,r.x));
  const total=rows.reduce((s,r)=>s+r.weight,0);
  const mean=rows.reduce((s,r)=>s+r.weight*r.y,0)/total,xmean=rows.reduce((s,r,i)=>s+r.weight*raw[i],0)/total;
  let cov=0,variance=0;
  rows.forEach((r,i)=>{const dx=raw[i]-xmean;cov+=r.weight*dx*(r.y-mean);variance+=r.weight*dx**2;});
  assert.equal(cal.rows,rows.length);assert.equal(cal.weight,total);near(cal.mean,mean);near(cal.predictedMean,xmean);
  near(cal.slope,variance>1e-12 ? Math.max(0,Math.min(1.5,cov/variance)) : 0);
}
function estimates(x,m) {
  const [p,g,l,s]=names.map(name=>{
    const c=m.calibration[name];return c.mean+c.slope*(predict(m.heads[name],x)-c.predictedMean);
  });
  const win=Math.min(.995,Math.max(.005,p));
  return {win,service:s,net:win*Math.max(0,g)-(1-win)*Math.max(0,l)};
}
function auditSelection(m) {
  const grid=[{shortOnly:true,minWin:0,hurdle:0,serviceCredit:0}];
  for (const minWin of [0,.4,.55]) for (const hurdle of [0,2,5]) for (const serviceCredit of [0,12]) {
    grid.push({shortOnly:false,minWin,hurdle,serviceCredit});
  }
  const candidates=m.selection.candidates;assert.deepEqual(grid,candidates.map(c=>c.settings));
  const sums=grid.map(()=>[0,0,0,0,0]);let n=0;
  visitWeeks(m.selectionStart,4096,frames=>{
    const scores=grid.map((s,i)=>{
      let pos=[0,1],net=0,service=0;
      for (const board of frames) {
        const row=entry(board,pos);
        let a=row.short;
        if (!s.shortOnly && row.p.eligible) {
          row.e??=estimates(row.p.x,m);const e=row.e;
          if (e.win>=s.minWin && e.net>s.hurdle && e.net+s.serviceCredit*e.service>s.hurdle) {a=row.long;sums[i][4]++;}
        }
        net+=a.net;service+=a.served;pos=a.positions;
      }
      return [net,service];
    });
    scores.forEach((v,i)=>{
      for (let k=0;k<2;k++){const d=v[k]-scores[0][k];sums[i][k*2]+=d;sums[i][k*2+1]+=d*d;}
    });n++;
  });
  assert.equal(n,m.selection.weeks);
  candidates.forEach((c,i)=>{
    assert.equal(c.switches,sums[i][4]);
    for (const [j,o] of [c.netShort,c.serviceShort].entries()) {
      const sum=sums[i][j*2],ss=sums[i][j*2+1];near(o.mean,sum/n);
      near(o.lowerSE,sum/n-Math.sqrt(Math.max(0,ss-sum*sum/n)/(n*(n-1))));
    }
  });
  const feasible=candidates.filter(c=>c.netShort.lowerSE>0 && c.serviceShort.mean>=0);
  assert.equal(feasible.length,m.selection.feasible);
  const best=feasible.find(c=>c.netShort.lowerSE===Math.max(...feasible.map(x=>x.netShort.lowerSE))) ?? candidates[0];
  assert.deepEqual(best.settings,m.settings);
}
for (const seed of process.argv[2] ? [Number(process.argv[2])] : seeds) {
  assert(seeds.includes(seed));
  const m=JSON.parse(readFileSync(new URL("longmove/fit-"+seed+".json",data)));
  assert.equal(m.format,"fleet-longmove-boost-v1");assert.equal(m.seed,seed);assert.deepEqual(m.historicalHashes,hashes);
  assert.equal(m.trainStart,800000000+1000000*seeds.indexOf(seed));assert.equal(m.calibrationStart,m.trainStart+200000);
  assert.equal(m.selectionStart,m.trainStart+400000);assert.equal(m.fitWeeks,90112);assert.equal(m.calibrationWeeks,22528);
  const train=collect(m.trainStart,8192),cal=collect(m.calibrationStart,2048);
  assert.deepEqual(counts(train),m.fitExamples);assert.deepEqual(counts(cal),m.calibrationExamples);
  let splits=0,maxErr=0;
  for (const name of names) {
    const {checked,maxLeafError}=auditTrees(targets(train,name),m.heads[name]);splits+=checked;maxErr=Math.max(maxErr,maxLeafError);
    calibration(targets(cal,name),m.heads[name],m.calibration[name]);
  }
  auditSelection(m);
  console.log("Audited",seed,train.length,"Friday branches,",cal.length,"calibration pairs,",splits,"tree splits, 19 full policies; max leaf error",maxErr.toExponential(2));
}
