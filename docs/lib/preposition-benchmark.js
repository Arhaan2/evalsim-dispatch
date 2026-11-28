import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeLongRepairPolicy} from "./longrepair-policy.js";
import {makeSwitchCostPolicy} from "./switchcost-policy.js";
import {makePrepositionPolicy} from "./preposition-policy.js";
import {PREPOSITION_SUITE, PREPOSITION_REFERENCES, prepositionCases, summarizePreposition,
  summarizePrepositionDurations} from "./preposition-study.js";

export {PREPOSITION_SUITE, PREPOSITION_SPLITS, prepositionCases, loadPrepositionBank} from "./preposition-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function prepositionReferences(weights) {
  return {
    rl:makePrepositionPolicy(weights.current,weights), planner:chooseClosurePlanner, flatRisk:makeClosureFlatRisk(weights),
    shortGate:makeLongRepairPolicy(weights.short,weights), previous:makeSwitchCostPolicy(weights.parent,weights),
  };
}
const suite = {id:PREPOSITION_SUITE, cases:prepositionCases, references:PREPOSITION_REFERENCES,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"], rowMetadata:r=>({duration:r.duration}),
  summarize:rows=>({...summarizePreposition(rows), ...summarizePrepositionDurations(rows)})};
export const benchmarkPreposition = options => benchmarkFleetSuite(suite,options);
export const verifyPrepositionReport = (report,weights,bank) => verifyFleetSuite(suite,report,bank);
