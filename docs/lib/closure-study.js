import {summarizeFleetReferences} from "./fleetweek-study.js";

export const CLOSURE_SUITE="dispatch-closure-v1";
export const CLOSURE_REFERENCES=Object.freeze(["rl","planner","flatRisk"]);
export const CLOSURE_SPLITS=Object.freeze(["validation","test","clean","archive"]);
const validation=["repair-transfer","repair-home-run"];
const fresh=["repair-crossing","repair-midweek-loop","repair-late-relay","repair-last-return"];
const profiles={
  validation:[[1,7],[[1,2,4],[2,3,5]]],
  test:[[3,5],[[1,2,4],[2,3,5],[1,4,5],[2,4,5]]],
};
const banks={
  validation:{families:validation,count:128,start:550000000},
  test:{families:fresh,count:2048,start:560000000},
  clean:{families:fresh,count:512,start:570000000},
  archive:{families:["double-return"],count:4096,start:580000000},
};

export function closureCases(split) {
  if (!Object.hasOwn(banks,split)) throw RangeError("Unknown depot closure bank.");
  const {families,count,start}=banks[split], profile=profiles[split];
  return families.flatMap((family,i)=>Array.from({length:count},(_,n)=>({
    family,seed:start+10000*i+n,closure:profile ? {starts:[...profile[0]],durations:[...profile[1][i]]} : null,
  })));
}

export function summarizeClosure(rows) {
  const summary=summarizeFleetReferences(rows,CLOSURE_REFERENCES);
  for (const group of [summary.all,...Object.values(summary.byFamily)]) {
    const c=group.comparisons.flatRisk;
    group.earnsMoreThanFlatRisk=c.net95[0]>0;
    group.matchesFlatRiskService=c.servicePP>=0 && c.service95[0]>=0;
    group.beatsFlatRisk=group.earnsMoreThanFlatRisk && group.matchesFlatRiskService;
  }
  return summary;
}
