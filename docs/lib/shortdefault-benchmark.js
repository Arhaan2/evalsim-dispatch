import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeLongRepairPolicy} from "./longrepair-policy.js";
import {makeShortDefaultPolicy} from "./shortdefault-policy.js";
import {SHORTDEFAULT_SUITE, SHORTDEFAULT_REFERENCES, shortDefaultCases, summarizeShortDefault,
  summarizeShortDefaultDurations} from "./shortdefault-study.js";

export {SHORTDEFAULT_SUITE, SHORTDEFAULT_SPLITS, shortDefaultCases} from "./shortdefault-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function shortDefaultReferences(weights) {
  return {
    rl:makeShortDefaultPolicy(weights.current, weights), planner:chooseClosurePlanner, flatRisk:makeClosureFlatRisk(weights),
    shortGate:makeLongRepairPolicy(weights.short, weights), longGate:makeLongRepairPolicy(weights.long, weights),
    flatGate:makeShortDefaultPolicy(weights.current, weights, {flatGate:true}),
  };
}
const suite = {id:SHORTDEFAULT_SUITE, cases:shortDefaultCases, references:SHORTDEFAULT_REFERENCES,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"], rowMetadata:r => ({duration:r.duration}),
  summarize:rows => ({...summarizeShortDefault(rows), ...summarizeShortDefaultDurations(rows)})};
export const benchmarkShortDefault = options => benchmarkFleetSuite(suite, options);
export const verifyShortDefaultReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
