import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {createClosureWeek} from "./closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "./closure-planner.js";
import {makeClosurePolicy} from "./closure-policy.js";
import {CLOSURE_SUITE, CLOSURE_REFERENCES, closureCases, summarizeClosure} from "./closure-study.js";

export {CLOSURE_SUITE, CLOSURE_SPLITS, closureCases} from "./closure-study.js";
export {createClosureWeek, closureActions} from "./closure-world.js";
export function closureReferences(weights) {
  return {rl:makeClosurePolicy(weights.current,weights), planner:chooseClosurePlanner, flatRisk:makeClosureFlatRisk(weights)};
}
const suite={id:CLOSURE_SUITE, cases:closureCases, references:CLOSURE_REFERENCES, summarize:summarizeClosure,
  createWeek:createClosureWeek, configKeys:["family","seed","closure"]};
export const benchmarkClosure=options=>benchmarkFleetSuite(suite,options);
export const verifyClosureReport=(report,weights,bank)=>verifyFleetSuite(suite,report,bank);
