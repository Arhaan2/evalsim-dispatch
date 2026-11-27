import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeLongRepairPolicy} from "./longrepair-policy.js";
import {makeLongMovePolicy} from "./longmove-policy.js";
import {makeMoveRecallPolicy} from "./moverecall-policy.js";
import {MOVERECALL_SUITE, MOVERECALL_REFERENCES, moveRecallCases, summarizeMoveRecall,
  summarizeMoveRecallDurations} from "./moverecall-study.js";

export {MOVERECALL_SUITE, MOVERECALL_SPLITS, moveRecallCases} from "./moverecall-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function moveRecallReferences(weights) {
  return {
    rl:makeMoveRecallPolicy(weights.current, weights), planner:chooseClosurePlanner, flatRisk:makeClosureFlatRisk(weights),
    shortGate:makeLongRepairPolicy(weights.short, weights), longGate:makeLongRepairPolicy(weights.long, weights),
    previous:makeLongMovePolicy(weights.previous,weights),
    flatGate:makeMoveRecallPolicy(weights.current, weights, {flatGate:true}),
  };
}
const suite = {id:MOVERECALL_SUITE, cases:moveRecallCases, references:MOVERECALL_REFERENCES,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"], rowMetadata:r => ({duration:r.duration}),
  summarize:rows => ({...summarizeMoveRecall(rows), ...summarizeMoveRecallDurations(rows)})};
export const benchmarkMoveRecall = options => benchmarkFleetSuite(suite, options);
export const verifyMoveRecallReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
