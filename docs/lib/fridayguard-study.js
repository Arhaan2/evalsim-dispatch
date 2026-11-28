import {loadFleetBank} from "./fleet-bank-loader.js";
import {FRIDAYGUARD_PATTERNS} from "./fridayguard-markets.js";
import {pairedFleetComparison,summarizeFleetGroup} from "./fleetweek-study.js";

export const FRIDAYGUARD_SUITE="dispatch-fridayguard-v1";
export const FRIDAYGUARD_SPLITS=Object.freeze(["validation","test","clean","archive"]);
export const FRIDAYGUARD_REFERENCES=Object.freeze(["rl","previous","fit211","frozen73","planner"]);
const families=Object.keys(FRIDAYGUARD_PATTERNS);
const banks={
  validation:{families:families.slice(0,2),count:128,start:1450000000,starts:[2,4,6],durations:[1,2,3,4,5]},
  test:{families:families.slice(2),count:4096,start:1460000000,starts:[3,5,7],durations:[1,2,3,4,4,4,5,5,5]},
  clean:{families:families.slice(2),count:512,start:1470000000},
  archive:{families:["double-return"],count:4096,start:1480000000},
};
export function fridayGuardCases(split) {
  if(!Object.hasOwn(banks,split))throw new RangeError("Unknown Friday guard split.");
  const {families,count,start,starts,durations}=banks[split];
  return families.flatMap((family,i)=>Array.from({length:count},(_,j)=>({
    family,seed:start+10000*i+j,closure:starts?{starts:[...starts],durations:[...durations]}:null,
  })));
}
export function loadFridayGuardBank(split,reader,digest,indices) {
  return loadFleetBank(FRIDAYGUARD_SUITE,banks,split,reader,digest,indices);
}
export {fleetTestShard as fridayGuardTestShard} from "./fleet-bank-loader.js";

// Two bits distinguish the individual Friday AM and PM contracts, even on weeks
// where the weekly Friday total is equal and the two dispatchers serve different loads.
export function fridayMask(actions) {
  const signed=id=>id.split("|").includes("C");
  return Number(signed(actions[8]))+2*Number(signed(actions[9]));
}
export function fridayGuardMetadata(reference,entrant) {
  const masks=Object.fromEntries(FRIDAYGUARD_REFERENCES.map(k=>[k,fridayMask(reference[k].actions)]));
  return {masks:{...masks,agent:fridayMask(entrant.actions)}};
}
const bitCounts=[0,1,1,2];
export function summarizeFriday(rows) {
  const agentTotal=rows.reduce((n,r)=>n+bitCounts[r.masks.agent],0);
  const comparisons={};
  for(const key of FRIDAYGUARD_REFERENCES) {
    let saved=0,lost=0,differentTotals=false;
    const weeks=rows.map(({family,masks})=>{
      saved+=bitCounts[masks.agent&~masks[key]];
      lost+=bitCounts[masks[key]&~masks.agent];
      const difference=bitCounts[masks.agent]-bitCounts[masks[key]];
      if(difference!==0)differentTotals=true;
      // The paired credit-interval routine is unit agnostic. Its net column carries
      // the signed Friday contract difference for this entire five-day week.
      return {family,agent:{net:difference,served:0},reference:{net:0,served:0}};
    });
    const perWeek95=differentTotals?pairedFleetComparison(weeks,"reference").net95:[0,0];
    const net=saved-lost;
    comparisons[key]={saved,lost,net,perWeek:net/rows.length,perWeek95};
  }
  return {agentTotal,comparisons};
}
export function fridayGuardGoals(comparisons,friday) {
  const goals={fridayFit211:friday.comparisons.fit211.perWeek95[0]>0,
    profitPlanner:comparisons.planner.net95[0]>0,deliveriesFrozen73:comparisons.frozen73.service95[0]>0,
    profitFrozen73:comparisons.frozen73.net95[0]>0,retainDeliveries101:comparisons.previous.service95[0]>=0,
    retainProfit101:comparisons.previous.net95[0]>=0};
  return {...goals,joint:Object.values(goals).every(Boolean)};
}
export function weeklyGuardTotals(comparisons,weeks) {
  return Object.fromEntries(Object.entries(comparisons).map(([key,c])=>[key,{
    netCredits:Math.round(c.net*weeks),netDeliveries:Math.round(c.servicePP*weeks/10),
    deliveriesPerWeek:c.servicePP/10,deliveriesPerWeek95:c.service95.map(v=>v/10),
  }]));
}
export function summarizeFridayGuard(rows) {
  function section(group) {
    const weekly=summarizeFleetGroup(group,FRIDAYGUARD_REFERENCES),friday=summarizeFriday(group);
    return {...weekly,weeklyTotals:weeklyGuardTotals(weekly.comparisons,group.length),friday,goals:fridayGuardGoals(weekly.comparisons,friday)};
  }
  return {all:section(rows),byFamily:Object.fromEntries(Array.from(Map.groupBy(rows,r=>r.family),([k,g])=>[k,section(g)]))};
}
