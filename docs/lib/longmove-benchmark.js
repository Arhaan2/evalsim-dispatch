import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeLongRepairPolicy} from "./longrepair-policy.js";
import {makeLongMovePolicy} from "./longmove-policy.js";
import {LONGMOVE_SUITE, LONGMOVE_REFERENCES, longMoveCases, summarizeLongMove,
  summarizeLongMoveDurations} from "./longmove-study.js";

export {LONGMOVE_SUITE, LONGMOVE_SPLITS, longMoveCases} from "./longmove-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function longMoveReferences(weights) {
  return {
    rl:makeLongMovePolicy(weights.current, weights), planner:chooseClosurePlanner, flatRisk:makeClosureFlatRisk(weights),
    shortGate:makeLongRepairPolicy(weights.short, weights), longGate:makeLongRepairPolicy(weights.long, weights),
    flatGate:makeLongMovePolicy(weights.current, weights, {flatGate:true}),
  };
}
const suite = {id:LONGMOVE_SUITE, cases:longMoveCases, references:LONGMOVE_REFERENCES,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"], rowMetadata:r => ({duration:r.duration}),
  summarize:rows => ({...summarizeLongMove(rows), ...summarizeLongMoveDurations(rows)})};
export const benchmarkLongMove = options => benchmarkFleetSuite(suite, options);
export const verifyLongMoveReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
