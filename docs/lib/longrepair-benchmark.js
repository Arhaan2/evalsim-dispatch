import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeClosurePolicy} from "./closure-policy.js";
import {makeLongRepairPolicy} from "./longrepair-policy.js";
import {LONGREPAIR_SUITE, LONGREPAIR_REFERENCES, longRepairCases, summarizeLongRepair, summarizeDurations} from "./longrepair-study.js";

export {LONGREPAIR_SUITE, LONGREPAIR_SPLITS, longRepairCases} from "./longrepair-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function longRepairReferences(weights) {
  return {
    rl:makeLongRepairPolicy(weights.current, weights), planner:chooseClosurePlanner,
    flatRisk:makeClosureFlatRisk(weights), closure:makeClosurePolicy(weights.closure, weights),
    flatGate:makeLongRepairPolicy(weights.current, weights, {flatGate:true}), shortGate:makeLongRepairPolicy(weights.short, weights),
  };
}
const suite = {id:LONGREPAIR_SUITE, cases:longRepairCases, references:LONGREPAIR_REFERENCES,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"], rowMetadata:r => ({duration:r.duration}),
  summarize:rows => ({...summarizeLongRepair(rows), ...summarizeDurations(rows)})};
export const benchmarkLongRepair = options => benchmarkFleetSuite(suite, options);
export const verifyLongRepairReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
