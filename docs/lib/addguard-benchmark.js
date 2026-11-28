import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeLongRepairPolicy} from "./longrepair-policy.js";
import {makeMoveRecallPolicy} from "./moverecall-policy.js";
import {makeSwitchCostPolicy} from "./switchcost-policy.js";
import {makeAddGuardPolicy} from "./addguard-policy.js";
import {ADDGUARD_SUITE, ADDGUARD_REFERENCES, addGuardCases, summarizeAddGuard,
  summarizeAddGuardDurations} from "./addguard-study.js";

export {ADDGUARD_SUITE, ADDGUARD_SPLITS, addGuardCases, loadAddGuardBank} from "./addguard-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function addGuardReferences(weights) {
  return {
    rl:makeAddGuardPolicy(weights.current,weights), planner:chooseClosurePlanner, flatRisk:makeClosureFlatRisk(weights),
    shortGate:makeLongRepairPolicy(weights.short,weights), previous:makeSwitchCostPolicy(weights.parent,weights),
    original:makeMoveRecallPolicy(weights.recall,weights),
  };
}
const suite = {id:ADDGUARD_SUITE, cases:addGuardCases, references:ADDGUARD_REFERENCES,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"], rowMetadata:r=>({duration:r.duration}),
  summarize:rows=>({...summarizeAddGuard(rows), ...summarizeAddGuardDurations(rows)})};
export const benchmarkAddGuard = options => benchmarkFleetSuite(suite,options);
export const verifyAddGuardReport = (report,weights,bank) => verifyFleetSuite(suite,report,bank);
