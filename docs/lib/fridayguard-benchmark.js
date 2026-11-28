import {benchmarkFleetSuite,verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner} from "./closure-planner.js";
import {makeSwitchCostPolicy} from "./switchcost-policy.js";
import {makePrepositionPolicy} from "./preposition-policy.js";
import {makeFridayGuardPolicy} from "./fridayguard-policy.js";
import {FRIDAYGUARD_SUITE,FRIDAYGUARD_REFERENCES,fridayGuardCases,fridayGuardMetadata,summarizeFridayGuard} from "./fridayguard-study.js";

export {FRIDAYGUARD_SUITE,FRIDAYGUARD_SPLITS,fridayGuardCases,loadFridayGuardBank} from "./fridayguard-study.js";
export {createClosureWeek,closureActions} from "./closure-world.js";
export function fridayGuardReferences(weights) {
  return {rl:makeFridayGuardPolicy(weights.current,weights),planner:chooseClosurePlanner,
    previous:makePrepositionPolicy(weights.preposition101,weights),fit211:makePrepositionPolicy(weights.preposition211,weights),
    frozen73:makeSwitchCostPolicy(weights.parent,weights)};
}
const suite={id:FRIDAYGUARD_SUITE,cases:fridayGuardCases,references:FRIDAYGUARD_REFERENCES,createWeek:createClosureWeek,
  configKeys:["family","seed","closure"],rowMetadata:fridayGuardMetadata,summarize:summarizeFridayGuard};
export const benchmarkFridayGuard=options=>benchmarkFleetSuite(suite,options);
export const verifyFridayGuardReport=(report,weights,bank)=>verifyFleetSuite(suite,report,bank);
