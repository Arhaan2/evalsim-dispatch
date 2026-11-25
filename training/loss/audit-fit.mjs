// Verify saved parameters against independently traversed returns and decisions.
// This auditor never imports the trainer, its labeler, selector or calibrator.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {FLEET_FAMILIES,FLEET_PAIRS,createFleetWeek,fleetWeekActions} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {candidateOnFrame,estimateCandidate,uncertaintyDecision,uncertaintyFrame} from "../../docs/lib/uncertainty-policy.js";
import {lossInputs} from "../../docs/lib/loss-policy.js";

const data=new URL("../../docs/data/",import.meta.url);
const bytes=(name,seed=13)=>readFileSync(new URL(name+"/model-"+seed+".json",data));
const overrideBytes=bytes("override"),uncertaintyBytes=bytes("uncertainty");
const override=JSON.parse(overrideBytes),uncertainty=JSON.parse(uncertaintyBytes);
const hash=b=>createHash("sha256").update(b).digest("hex");
const registered=[13,37,73,101,211], families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
const round=n=>Number(n.toFixed(8));
const dot=(x,w)=>x.reduce((sum,v,j)=>sum+v*w[j],0);
function eachWeek(start,count,fn) {
  for (const [f,family] of families.entries()) for (let i=0;i<count;i++) {
    const world=createFleetWeek({seed:start+f*count+i,family}),frames=[];
    while (!world.done) {
      frames.push({...uncertaintyFrame(world.observe()),cache:new Map()});
      world.step("W|W");
    }
    fn(frames);
  }
}
function candidate(frame,pos) {
  const key=pos.join("|");
  if (!frame.cache.has(key)) {
    const c=candidateOnFrame(frame,fleetWeekActions({...frame.obs,positions:pos}),override);
    if (c.proposal) {
      const decision=uncertaintyDecision(c,estimateCandidate(c,uncertainty),uncertainty.settings,
        uncertainty.flatDownside,{flatRisk:true});
      c.suffix = decision.chosenId===c.planner.id ? c.planner : c.proposal;
      c.inputs=lossInputs(frame,c,uncertainty);
      assert.equal(c.inputs.suffixId,c.suffix.id);
    } else c.suffix=c.planner;
    frame.cache.set(key,c);
  }
  return frame.cache.get(key);
}
function playForward(frames,t,first) {
  let a=first,net=first.net,served=first.served;
  for (const later of frames.slice(t+1)) {
    a=candidate(later,a.positions).suffix;
    net+=a.net;served+=a.served;
  }
  return {net,served};
}
function pairs(start,count,fn) {
  eachWeek(start,count,frames=>{
    for (const t of [1,3,5,7]) for (const pos of FLEET_PAIRS) {
      const c=candidate(frames[t],pos);
      if (!c.proposal) continue;
      const p=playForward(frames,t,c.proposal),r=playForward(frames,t,c.planner);
      fn(c.inputs,p.net-r.net,p.served-r.served);
    }
  });
}
function gradient(weights) {
  const sum=new Float64Array(weights.length);
  let n=0;
  return {
    add(x,target){
      const err=target-dot(x,weights);n++;
      for(let j=0;j<x.length;j++) sum[j]+=x[j]*err;
    },
    check(expected){
      assert.equal(n,expected);const errors=weights.map((w,i)=>Math.abs(sum[i]/n-(i?0.01*w:0)));
      const max=Math.max(...errors);
      assert(max<1e-6,"Ridge first-order residual "+max);return max;
    },
  };
}
function gradients(m) {
  const binary=gradient(m.classLoss),service=gradient(m.service),negative=gradient(m.lossAmount),
    positive=gradient(m.nonLossAmount);
  let ties=0;
  pairs(m.trainStart,1024,(i,n,s)=>{
    binary.add(i.x,Number(n<0)-i.outlook.loss);service.add(i.x,s-i.legacyService);
    if (n<0) negative.add(i.x,-n-i.outlook.cost);
    else positive.add(i.x,n-i.outlook.gain);
    if (n===0) ties++;
  });
  assert.equal(m.fitTies,ties);
  return Math.max(binary.check(m.fitExamples),service.check(m.fitExamples),
    negative.check(m.fitLosses),positive.check(m.fitExamples-m.fitLosses));
}
function raw(i,m) {return Math.max(0,Math.min(1,i.outlook.loss+dot(i.x,m.classLoss)));}
function bin(probability) {return Math.min(9,Math.floor(probability*10));}
function calibration(m) {
  const n=Array(10).fill(0),bad=Array(10).fill(0);
  pairs(m.calibrationStart,512,(i,net)=>{
    const j=bin(raw(i,m));n[j]++;if(net<0)bad[j]++;
  });
  assert.deepEqual(n,m.binCounts);assert.deepEqual(bad,m.binLosses);
  const sum=values=>values.reduce((a,b)=>a+b,0);
  assert.equal(sum(n),m.calibrationExamples);assert.equal(sum(bad)/sum(n),m.globalLossRate);
  // Weighted isotonic regression's max-of-minimum interval-average formula.
  for(let j=0;j<10;j++) {
    let maximum=0;
    for(let a=0;a<=j;a++){
      let minimum=1;
      for(let b=j;b<10;b++){
        let size=0,y=0;
        for(let k=a;k<=b;k++){size+=n[k]+10;y+=bad[k]+k+0.5;}
        minimum=Math.min(minimum,y/size);
      }
      maximum=Math.max(maximum,minimum);
    }
    assert(Math.abs(maximum-m.calibratedBins[j])<1e-12);
  }
}
function selections(m) {
  const options=[{blend:1,serviceCredit:0,hurdle:0,plannerOnly:true}];
  for(const blend of [.5,1])for(const serviceCredit of [0,15,35])for(const hurdle of [0,2,4])
    options.push({blend,serviceCredit,hurdle,plannerOnly:false});
  const stats=options.map(()=>({net:0,square:0,service:0,serviceSquare:0,overrides:0}));
  let n=0;
  eachWeek(m.selectionStart,768,frames=>{
    n++;let baseline;
    for(const [j,option] of options.entries()){
      let pos=[0,1],net=0,service=0;
      for(const frame of frames){
        const c=candidate(frame,pos);
        let a=c.planner;
        if(c.proposal && !option.plannerOnly) {
          const i=c.inputs;
          if(!c.values) {
            const p=m.calibratedBins[bin(raw(i,m))];
            const loss=Math.max(0,i.outlook.cost+dot(i.x,m.lossAmount));
            const win=Math.max(0,i.outlook.gain+dot(i.x,m.nonLossAmount));
            c.values={net:(1-p)*win-p*loss,served:i.legacyService+dot(i.x,m.service)};
          }
          const value=option.blend*c.values.net+(1-option.blend)*i.legacyNet+
            option.serviceCredit*c.values.served;
          if(value>option.hurdle) {a=c.proposal;stats[j].overrides++;}
        }
        net+=a.net;service+=a.served;pos=a.positions;
      }
      if(j===0)baseline={net,service};
      const d=net-baseline.net,s=service-baseline.service,stat=stats[j];
      stat.net+=d;stat.square+=d*d;stat.service+=s;stat.serviceSquare+=s*s;
    }
  });
  const lower=(sum,square)=>round(sum/n-Math.sqrt(Math.max(0,(square-sum*sum/n)/(n-1))/n));
  const rows=stats.map((s,i)=>({settings:options[i],net:round(s.net/n),service:round(s.service/n),
    netLowerSE:lower(s.net,s.square),serviceLowerSE:lower(s.service,s.serviceSquare),overrides:s.overrides}));
  assert.deepEqual(rows,m.selection.candidates);
  const feasible=rows.filter(row=>row.serviceLowerSE>=0);
  const best=feasible.find(row=>row.netLowerSE===Math.max(...feasible.map(row=>row.netLowerSE)));
  assert.deepEqual(m.settings,best.settings);assert.equal(m.selection.feasible,feasible.length);
  assert.equal(m.selection.weeks,n);
  return n*options.length;
}
const seeds=process.argv[2]?[Number(process.argv[2])]:registered;
for(const seed of seeds) {
  const index=registered.indexOf(seed);
  assert(index>=0);
  const m=JSON.parse(bytes("loss",seed));
  assert.equal(m.format,"fleet-loss-mc-v1");assert.equal(m.seed,seed);
  assert.equal(m.overrideHash,hash(overrideBytes));assert.equal(m.uncertaintyHash,hash(uncertaintyBytes));
  assert.equal(m.trainStart,400000000+index*1000000);assert.equal(m.calibrationStart,m.trainStart+200000);
  assert.equal(m.selectionStart,m.trainStart+400000);assert.equal(m.fitWeeks,11264);assert.equal(m.calibrationWeeks,5632);
  const worst=gradients(m);calibration(m);const paths=selections(m);
  console.log("Verified fit",seed,m.fitExamples,"forward Friday comparisons,",m.calibrationExamples,
    "calibration pairs,",paths,"selection paths, maximum ridge residual",worst);
}
