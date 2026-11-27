import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeLongRepairPolicy} from "./longrepair-policy.js";
import {makeLongMovePolicy} from "./longmove-policy.js";
import {makeMoveRecallPolicy} from "./moverecall-policy.js";
import {makeSwitchCostPolicy} from "./switchcost-policy.js";
import {SWITCHCOST_SUITE, SWITCHCOST_REFERENCES, switchCostCases, summarizeSwitchCost,
  summarizeSwitchCostDurations} from "./switchcost-study.js";

export {SWITCHCOST_SUITE, SWITCHCOST_SPLITS, switchCostCases} from "./switchcost-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function switchCostReferences(weights) {
  return {
    rl:makeSwitchCostPolicy(weights.current, weights), planner:chooseClosurePlanner, flatRisk:makeClosureFlatRisk(weights),
    shortGate:makeLongRepairPolicy(weights.short, weights), longGate:makeLongRepairPolicy(weights.long, weights),
    previous:makeMoveRecallPolicy(weights.recall,weights), original:makeLongMovePolicy(weights.previous,weights),
    flatGate:makeSwitchCostPolicy(weights.current, weights, {flatGate:true}),
  };
}
const suite = {id:SWITCHCOST_SUITE, cases:switchCostCases, references:SWITCHCOST_REFERENCES,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"], rowMetadata:r => ({duration:r.duration}),
  summarize:rows => ({...summarizeSwitchCost(rows), ...summarizeSwitchCostDurations(rows)})};
export const benchmarkSwitchCost = options => benchmarkFleetSuite(suite, options);
export const verifySwitchCostReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
