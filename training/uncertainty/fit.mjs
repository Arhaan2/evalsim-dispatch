import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {createFleetWeek,FLEET_FAMILIES,fleetWeekActions} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {candidateOnFrame,conditionalMeans,downsideFeatures,estimateCandidate,
  uncertaintyDecision,uncertaintyFrame} from "../../docs/lib/uncertainty-policy.js";
import {solveFleetRidge} from "../fleetweek/fit.mjs";

export const UNCERTAINTY_FIT=Object.freeze({
  seeds:[13,37,73,101,211],families:[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES],
  fitStart:300000000,stride:1000000,calibrationOffset:200000,selectionOffset:400000,
  fitCount:768,calibrationCount:512,selectionCount:512,ridge:0.01,
  blends:[0.5,1],serviceCredits:[0,15,35],lambdas:[0.08,0.20,0.40],
});
const ordered=Array.from({length:9},(_,i)=>[Math.floor(i/3),i%3]);
const indexOf=positions=>3*positions[0]+positions[1];
const rounded=x=>Number(x.toFixed(8));
const root=new URL("../../docs/data/",import.meta.url);
const predecessorBytes=readFileSync(new URL("override/model-13.json",root));
const priorHash=createHash("sha256").update(predecessorBytes).digest("hex");
assert.equal(priorHash,"f70b76a430aadf6c0050a2041208d8fc549c0767b98291574971b681e16a05f9");
const predecessor=JSON.parse(predecessorBytes);

function eachWeek(start,count,visit) {
  UNCERTAINTY_FIT.families.forEach((family,i)=>{
    for(let k=0;k<count;k++)visit({family,seed:start+i*count+k});
  });
}
function frames(config) {
  const world=createFleetWeek(config), result=[];
  while(!world.done) {
    result.push({...uncertaintyFrame(world.observe()),placements:[]});
    world.step("W|W");
  }
  return result;
}
function candidate(frame,positions) {
  const index=indexOf(positions);
  return frame.placements[index] ??= candidateOnFrame(frame,fleetWeekActions({...frame.obs,positions}),predecessor);
}

// Exact finite-tape evaluation of the deployed predecessor after tonight's
// intervention. All nine ordered arrivals are used for its named-truck ties.
function labeledExamples(start,count,visit) {
  eachWeek(start,count,config=>{
    const week=frames(config);
    let futureNet=new Float64Array(9),futureService=new Float64Array(9);
    for(let t=9;t>=0;t--) {
      const net=new Float64Array(9),service=new Float64Array(9);
      for(const [i,positions] of ordered.entries()) {
        const c=candidate(week[t],positions),action=c.proposal??c.planner;
        const next=indexOf(action.positions);
        net[i]=action.net+futureNet[next];
        service[i]=action.served+futureService[next];
        if(!c.proposal || positions[0]>positions[1])continue;
        const refEnd=indexOf(c.planner.positions);
        visit(c,net[i]-c.planner.net-futureNet[refEnd],service[i]-c.planner.served-futureService[refEnd]);
      }
      futureNet=net;futureService=service;
    }
  });
}

function accumulation() {
  let gram,values,n=0;
  return {
    add(x,targets) {
      gram??=Array.from(x,()=>new Float64Array(x.length));
      values??=targets.map(()=>new Float64Array(x.length));
      for(let i=0;i<x.length;i++) {
        if(x[i]===0)continue;
        for(let j=0;j<=i;j++)gram[i][j]+=x[i]*x[j];
        for(let h=0;h<targets.length;h++)values[h][i]+=x[i]*targets[h];
      }
      n++;
    },
    finish() {return {weights:solveFleetRidge(gram,values,n,UNCERTAINTY_FIT.ridge),n};},
  };
}

function fitMeans(start) {
  const stats=accumulation();
  labeledExamples(start,UNCERTAINTY_FIT.fitCount,(c,net,service)=>{
    stats.add(c.x,[net-c.priorNetGain,service-c.priorServiceGain]);
  });
  const {weights:[net,service],n}=stats.finish();
  return {net,service,fitExamples:n};
}
function calibrate(start,model) {
  const stats=accumulation(),xs=[];
  let total=0;
  labeledExamples(start,UNCERTAINTY_FIT.calibrationCount,(c,net)=>{
    const means=conditionalMeans(c,model);
    const shortfall=Math.max(0,means.riskMean-net);
    const x=downsideFeatures(c,means);
    stats.add(x,[shortfall]);xs.push(x);total+=shortfall;
  });
  const {weights:[downside],n}=stats.finish();
  const fitted=xs.map(x=>Math.max(0,downside.reduce((sum,w,i)=>sum+w*x[i],0))).sort((a,b)=>a-b);
  const riskCuts=[fitted[Math.floor((n-1)/3)],fitted[Math.floor(2*(n-1)/3)]];
  return {downside,calibrationExamples:n,flatDownside:total/n,riskCuts};
}

export function uncertaintySettings() {
  const options=[{blend:1,serviceCredit:0,lambda:0.08,plannerOnly:true}];
  for(const blend of UNCERTAINTY_FIT.blends)for(const serviceCredit of UNCERTAINTY_FIT.serviceCredits)
    for(const lambda of UNCERTAINTY_FIT.lambdas)options.push({blend,serviceCredit,lambda,plannerOnly:false});
  return options;
}

function selection(start,model) {
  const options=uncertaintySettings(),stats=options.map(()=>({profit:0,square:0,service:0,serviceSquare:0,overrides:0}));
  let weeks=0;
  eachWeek(start,UNCERTAINTY_FIT.selectionCount,config=>{
    const week=frames(config);
    let plannerNet,plannerService;
    for(const [i,settings] of options.entries()){
      let positions=[0,1],net=0,served=0;
      for(const frame of week){
        const c=candidate(frame,positions);
        if(c.estimate===undefined)c.estimate=estimateCandidate(c,model);
        const d=uncertaintyDecision(c,c.estimate,settings,model.flatDownside);
        const a=d.chosenId===d.plannerId ? c.planner : c.proposal;
        net+=a.net;served+=a.served;positions=a.positions;
        if(d.chosenId!==d.plannerId)stats[i].overrides++;
      }
      if(i===0){plannerNet=net;plannerService=served;}
      const gain=net-plannerNet,service=served-plannerService;
      const s=stats[i];
      s.profit+=gain;s.square+=gain*gain;s.service+=service;s.serviceSquare+=service*service;
    }
    weeks++;
  });
  const lower=(sum,square)=>rounded(sum/weeks-Math.sqrt(Math.max(0,square-sum*sum/weeks)/(weeks*(weeks-1))));
  const candidates=stats.map((s,i)=>({settings:options[i],net:rounded(s.profit/weeks),service:rounded(s.service/weeks),
    netLowerSE:lower(s.profit,s.square),serviceLowerSE:lower(s.service,s.serviceSquare),overrides:s.overrides}));
  const feasible=candidates.filter(row=>row.serviceLowerSE>=0);
  const selected=feasible.reduce((best,row)=>row.netLowerSE>best.netLowerSE ? row : best);
  return {settings:selected.settings,selection:{weeks,candidates,feasible:feasible.length}};
}

export function fitUncertainty(seed) {
  const index=UNCERTAINTY_FIT.seeds.indexOf(seed);
  if(index<0)throw RangeError("Unknown registered uncertainty fit seed.");
  const trainStart=UNCERTAINTY_FIT.fitStart+index*UNCERTAINTY_FIT.stride;
  const calibrationStart=trainStart+UNCERTAINTY_FIT.calibrationOffset;
  const selectionStart=trainStart+UNCERTAINTY_FIT.selectionOffset;
  const heads=fitMeans(trainStart);
  const model={...heads,...calibrate(calibrationStart,heads)};
  return {format:"fleet-uncertainty-mc-v1",seed,priorHash,trainStart,calibrationStart,selectionStart,
    fitWeeks:UNCERTAINTY_FIT.families.length*UNCERTAINTY_FIT.fitCount,
    calibrationWeeks:UNCERTAINTY_FIT.families.length*UNCERTAINTY_FIT.calibrationCount,...model,...selection(selectionStart,model)};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const mode=process.argv[2];
  if(!["--write","--check"].includes(mode))throw Error("Choose --write to fit or --check to reproduce.");
  const dir=new URL("uncertainty/",root);
  if(mode==="--write")mkdirSync(dir,{recursive:true});
  for(const seed of UNCERTAINTY_FIT.seeds){
    const m=fitUncertainty(seed),bytes=JSON.stringify(m)+"\n",file=new URL("model-"+seed+".json",dir);
    if(mode==="--write")writeFileSync(file,bytes);
    else assert.equal(bytes,readFileSync(file,"utf8"),"Checkpoint mismatch for "+seed);
    console.log(mode,seed,m.fitExamples,"training proposals,",m.calibrationExamples,"calibration proposals",m.settings);
  }
}
