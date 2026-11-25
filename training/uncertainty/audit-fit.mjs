// Verify training separately by running both actions forward from their actual
// destinations. The fitter computes labels backwards for all nine arrivals.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createFleetWeek,FLEET_FAMILIES,FLEET_PAIRS,fleetWeekActions} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {candidateOnFrame,downsideFeatures,uncertaintyFrame} from "../../docs/lib/uncertainty-policy.js";

const data=new URL("../../docs/data/",import.meta.url);
const priorBytes=readFileSync(new URL("override/model-13.json",data));
const prior=JSON.parse(priorBytes);
const priorHash=createHash("sha256").update(priorBytes).digest("hex");
const seeds=[13,37,73,101,211],families=[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES];
const dot=(row,x)=>x.reduce((s,v,i)=>s+v*row[i],0);
const rounded=n=>Number(n.toFixed(8));
function eachWeek(start,count,visit) {
  for(const [f,family] of families.entries())for(let j=0;j<count;j++){
    const world=createFleetWeek({family,seed:start+f*count+j});
    const frames=[];
    while(!world.done){
      frames.push({...uncertaintyFrame(world.observe()),store:new Map()});
      world.step("W|W");
    }
    visit(frames);
  }
}
function board(frame,positions) {
  const key=positions.join("|");
  if(!frame.store.has(key)){
    const menu=fleetWeekActions({...frame.obs,positions});
    frame.store.set(key,candidateOnFrame(frame,menu,prior));
  }
  return frame.store.get(key);
}
function finish(frames,t,action){
  let net=action.net,served=action.served,pos=action.positions;
  for(let i=t+1;i<frames.length;i++){
    const c=board(frames[i],pos);
    const a=c.proposal??c.planner;
    net+=a.net;served+=a.served;pos=a.positions;
  }
  return {net,served};
}
function paired(start,count,visit){
  eachWeek(start,count,frames=>{
    for(const t of [1,3,5,7])for(const positions of FLEET_PAIRS) {
      const c=board(frames[t],positions);
      if(!c.proposal)continue;
      const p=finish(frames,t,c.planner),other=finish(frames,t,c.proposal);
      visit(c,other.net-p.net,other.served-p.served);
    }
  });
}
function means(c,m){
  return {riskMean:c.priorNetGain+dot(m.net,c.x),fittedService:c.priorServiceGain+dot(m.service,c.x)};
}
function gradient(weights) {
  const sums=new Float64Array(weights.length);let n=0;
  return {
    add(x,error){n++;for(let j=0;j<x.length;j++)sums[j]+=x[j]*error;},
    verify(count){
      assert.equal(n,count);
      const maximum=Math.max(...sums.map((g,j)=>Math.abs(g/n-(j?0.01*weights[j]:0))));
      assert(maximum<1e-6,"Ridge equation error "+maximum);
      return maximum;
    },
  };
}
function auditHeads(m) {
  const netGradient=gradient(m.net),serviceGradient=gradient(m.service),downGradient=gradient(m.downside);
  paired(m.trainStart,768,(c,net,served)=>{
    const {riskMean,fittedService}=means(c,m);
    netGradient.add(c.x,net-riskMean);serviceGradient.add(c.x,served-fittedService);
  });
  let sum=0;
  const predicted=[];
  paired(m.calibrationStart,512,(c,net)=>{
    const prediction=means(c,m);
    const x=downsideFeatures(c,prediction),raw=dot(m.downside,x);
    const target=Math.max(0,prediction.riskMean-net);
    downGradient.add(x,target-raw);
    predicted.push(Math.max(0,raw));sum+=target;
  });
  assert(Math.abs(sum/predicted.length-m.flatDownside)<1e-8);
  predicted.sort((a,b)=>a-b);
  const cutValues=[predicted[Math.floor((predicted.length-1)/3)],predicted[Math.floor(2*(predicted.length-1)/3)]];
  for(const [i,cut] of cutValues.entries())assert(Math.abs(cut-m.riskCuts[i])<1e-8);
  return Math.max(netGradient.verify(m.fitExamples),serviceGradient.verify(m.fitExamples),downGradient.verify(m.calibrationExamples));
}
function options() {
  const options=[{blend:1,serviceCredit:0,lambda:0.08,plannerOnly:true}];
  for(const blend of [0.5,1])for(const serviceCredit of [0,15,35])for(const lambda of [0.08,0.2,0.4])
    options.push({blend,serviceCredit,lambda,plannerOnly:false});
  return options;
}
function verifySelection(m){
  const settings=options();
  const scores=settings.map(()=>({sum:0,sq:0,served:0,servedSq:0,overrides:0}));
  let n=0;
  eachWeek(m.selectionStart,512,frames=>{
    n++;
    let reference;
    for(const [i,o] of settings.entries()){
      let pos=[0,1],net=0,contracts=0;
      for(const frame of frames){
        const c=board(frame,pos);
        let a=c.planner;
        if(c.proposal && !o.plannerOnly){
          if(!c.forecast){
            const mu=means(c,m);
            c.forecast={...mu,risk:Math.max(0,dot(m.downside,downsideFeatures(c,mu)))};
          }
          const mu=c.forecast;
          const gain=c.priorNetGain+o.blend*(mu.riskMean-c.priorNetGain);
          const service=c.priorServiceGain+o.blend*(mu.fittedService-c.priorServiceGain);
          if(gain+o.serviceCredit*service>o.lambda*mu.risk){a=c.proposal;scores[i].overrides++;}
        }
        net+=a.net;contracts+=a.served;pos=a.positions;
      }
      if(i===0)reference={net,contracts};
      const diff=net-reference.net,service=contracts-reference.contracts,row=scores[i];
      row.sum+=diff;row.sq+=diff**2;row.served+=service;row.servedSq+=service**2;
    }
  });
  const lower=(sum,ss)=>rounded(sum/n-Math.sqrt(Math.max(0,(ss-sum*sum/n)/(n-1)))/Math.sqrt(n));
  const rows=scores.map((s,i)=>({settings:settings[i],net:rounded(s.sum/n),service:rounded(s.served/n),
    netLowerSE:lower(s.sum,s.sq),serviceLowerSE:lower(s.served,s.servedSq),overrides:s.overrides}));
  assert.deepEqual(rows,m.selection.candidates);
  const feasible=rows.filter(row=>row.serviceLowerSE>=0);
  assert.equal(feasible.length,m.selection.feasible);assert.equal(n,m.selection.weeks);
  assert.deepEqual(feasible.find(row=>row.netLowerSE===Math.max(...feasible.map(r=>r.netLowerSE))).settings,m.settings);
  return n*settings.length;
}

let fitPairs=0,calibrationPairs=0,rollouts=0,largest=0;
for(const [index,seed] of seeds.entries()){
  const m=JSON.parse(readFileSync(new URL("uncertainty/model-"+seed+".json",data)));
  assert.equal(m.format,"fleet-uncertainty-mc-v1");assert.equal(m.priorHash,priorHash);
  assert.equal(m.seed,seed);assert.equal(m.trainStart,300000000+index*1000000);
  assert.equal(m.calibrationStart,m.trainStart+200000);assert.equal(m.selectionStart,m.trainStart+400000);
  assert.equal(m.fitWeeks,8448);assert.equal(m.calibrationWeeks,5632);
  assert.equal(m.net.length,90);assert.equal(m.service.length,90);assert.equal(m.downside.length,53);
  const worst=auditHeads(m),weeks=verifySelection(m);
  fitPairs+=m.fitExamples;calibrationPairs+=m.calibrationExamples;rollouts+=weeks;largest=Math.max(largest,worst);
  console.log("Verified",seed,m.fitExamples,"paired fits,",m.calibrationExamples,"paired calibration cases,",weeks,"selection rollouts.");
}
console.log("Verified",fitPairs,"mean returns,",calibrationPairs,"downside labels,",rollouts,"selection paths; worst ridge error",largest);
