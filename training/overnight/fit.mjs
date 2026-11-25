import { createFleetWeek, FLEET_FAMILIES, FLEET_PAIRS, fleetPairIndex, fleetWeekActions } from "../../docs/lib/fleetweek.js";
import { bestFleetAction, fleetPlannerContinuation } from "../../docs/lib/fleetweek-planner.js";
import { centerFleetValues, isOvernight, overnightFeatures, overnightHeads, rankOvernight } from "../../docs/lib/overnight-policy.js";
import { solveFleetRidge } from "../fleetweek/fit.mjs";

export const OVERNIGHT_FIT = Object.freeze({
  seeds: [13,37,73,101,211], releaseSeed:13, weeksPerFamily:768, selectionPerFamily:384,
  firstSeed:100000000, fitStride:1000000, selectionOffset:200000, ridge:0.002,
  blends:[0.45,0.9], serviceCredits:[0,10,30], minimumGains:[0,1.5],
});
const pairs = FLEET_PAIRS.length;

function readFrames(config) {
  const world = createFleetWeek(config), frames = [];
  while (!world.done) {
    const obs = world.observe();
    frames.push({obs, base:fleetPlannerContinuation(obs)});
    // Future arrivals are independent of truck moves. The estimator below
    // evaluates every pair of truck starting positions on this same tape.
    world.step("W|W");
  }
  return frames;
}

// Exact policy evaluation on one training tape for all six possible arrivals.
// The endogenous truck state follows the planner; these are implementable
// receding-horizon actions, never hindsight-optimal bookings.
export function pairedFridayReturns(frames) {
  let laterNet = new Float64Array(pairs), laterServed = new Float64Array(pairs);
  const nights=[];
  for (let t=frames.length-1; t>=0; t--) {
    if (isOvernight(t)) nights[(t-1)/2] = {net:laterNet, service:laterServed};
    const {obs,base}=frames[t];
    const net = new Float64Array(pairs), served = new Float64Array(pairs);
    for (const [p,positions] of FLEET_PAIRS.entries()) {
      const menu = fleetWeekActions({...obs,positions});
      const selected = bestFleetAction(menu, base);
      const action = menu.find(a=>a.id===selected);
      const next = fleetPairIndex(action.positions);
      net[p] = action.net + laterNet[next];
      served[p] = action.served + laterServed[next];
    }
    laterNet=net;
    laterServed=served;
  }
  return nights;
}

function accumulator(d) {
  return {
    gram:Array.from({length:d},()=>new Float64Array(d)),
    rhs:Array.from({length:2*pairs},()=>new Float64Array(d)),
    count:0,
  };
}
function addBoard(stats,x,target) {
  for (let i=0; i<x.length; i++) {
    const xi=x[i];
    for (let j=0; j<=i; j++) stats.gram[i][j]+=xi*x[j];
    for (let p=0; p<target.length; p++) stats.rhs[p][i]+=xi*target[p];
  }
  stats.count++;
}

function forTrainingWeeks(start,count,callback) {
  for (const [i,family] of FLEET_FAMILIES.train.entries()) {
    for (let k=0; k<count; k++) callback({family,seed:start+i*count+k});
  }
}

function fitHeads(start) {
  const stats=[];
  forTrainingWeeks(start, OVERNIGHT_FIT.weeksPerFamily, config=>{
    const frames=readFrames(config);
    const returns=pairedFridayReturns(frames);
    for (const [i,r] of returns.entries()) {
      const {obs,base} = frames[2*i+1];
      const x=overnightFeatures(obs,base);
      const residual = centerFleetValues(r.net.map((v,p)=>v-base[p]));
      const target = [...residual,...centerFleetValues(r.service)];
      stats[i] ??= accumulator(x.length);
      addBoard(stats[i],x,target);
    }
  });
  return stats.map(s=>{
    const rows=solveFleetRidge(s.gram,s.rhs,s.count,OVERNIGHT_FIT.ridge);
    return {net:rows.slice(0,pairs),service:rows.slice(pairs)};
  });
}

function candidateSettings() {
  return OVERNIGHT_FIT.blends.flatMap(blend => OVERNIGHT_FIT.serviceCredits.flatMap(serviceCredit =>
    OVERNIGHT_FIT.minimumGains.map(minimumGain => ({blend,serviceCredit,minimumGain}))));
}
function selectionWeek(frames,settings) {
  let positions=[0,1], net=0, served=0, changed=0;
  for (const {obs,base,heads} of frames) {
    const menu=fleetWeekActions({...obs,positions});
    const refId=bestFleetAction(menu,base);
    const ref=menu.find(a=>a.id===refId);
    const id=settings && heads ? rankOvernight(menu,ref,base,heads,settings) : refId;
    const move=menu.find(a=>a.id===id);
    positions=move.positions;
    net+=move.net;
    served+=move.served;
    changed+=Number(id!==refId);
  }
  return {net,served,changed};
}

function oneStandardError(sum,sumSquares,n) {
  return Math.sqrt(Math.max(0, sumSquares-sum*sum/n)/(n*(n-1)));
}
const rounded = value=>Number(value.toFixed(8));
function selectSettings(start,nights) {
  const choices=candidateSettings();
  const counts=choices.map(()=>({net:0,netSquares:0,served:0,servedSquares:0,changed:0}));
  let n=0;
  forTrainingWeeks(start,OVERNIGHT_FIT.selectionPerFamily,config=>{
    const frames=readFrames(config);
    for (const f of frames) if (isOvernight(f.obs.epoch)) f.heads=overnightHeads(f.obs,f.base,{nights});
    const planner=selectionWeek(frames,null);
    choices.forEach((c,i)=>{
      const other=selectionWeek(frames,c);
      const gain=other.net-planner.net, service=other.served-planner.served;
      const s=counts[i];
      s.net+=gain;s.netSquares+=gain*gain;
      s.served+=service;s.servedSquares+=service*service;s.changed+=other.changed;
    });
    n++;
  });
  const candidates=choices.map((settings,i)=>{
    const s=counts[i];
    return {settings,net:rounded(s.net/n),service:rounded(s.served/n),
      netLowerSE:rounded(s.net/n-oneStandardError(s.net,s.netSquares,n)),
      serviceLowerSE:rounded(s.served/n-oneStandardError(s.served,s.servedSquares,n)), changed:s.changed};
  });
  const feasible=candidates.filter(s=>s.serviceLowerSE>=0);
  const winner=feasible.length ? [...feasible].sort((a,b)=>b.netLowerSE-a.netLowerSE)[0] :
    [...candidates].sort((a,b)=>b.serviceLowerSE-a.serviceLowerSE || b.netLowerSE-a.netLowerSE)[0];
  return {settings:winner.settings,selection:{weeks:n,candidates,serviceFeasible:feasible.length}};
}

export function fitOvernight(seed) {
  const index=OVERNIGHT_FIT.seeds.indexOf(seed);
  if (index<0) throw RangeError("Unknown registered overnight fit seed.");
  const trainStart=OVERNIGHT_FIT.firstSeed+index*OVERNIGHT_FIT.fitStride;
  const selectStart=trainStart+OVERNIGHT_FIT.selectionOffset;
  const nights=fitHeads(trainStart);
  const selected=selectSettings(selectStart,nights);
  return {format:"fleet-overnight-mc-v1",seed,trainStart,selectStart,
    weeks:OVERNIGHT_FIT.weeksPerFamily*FLEET_FAMILIES.train.length,
    features:nights[0].net[0].length,nights,...selected};
}
