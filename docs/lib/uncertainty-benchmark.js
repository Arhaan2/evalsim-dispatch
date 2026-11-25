import {chooseFleetPlanner} from "./fleetweek-planner.js";
import {makeFleetPolicy} from "./fleetweek-policy.js";
import {makeOvernightPolicy} from "./overnight-policy.js";
import {makeOverridePolicy} from "./override-policy.js";
import {makeUncertaintyPolicy} from "./uncertainty-policy.js";
import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {UNCERTAINTY_SUITE, UNCERTAINTY_REFERENCES, uncertaintyCases, summarizeUncertainty} from "./uncertainty-study.js";

export {UNCERTAINTY_SUITE, UNCERTAINTY_SPLITS, UNCERTAINTY_FAMILIES, uncertaintyCases} from "./uncertainty-study.js";
export {createFleetWeek, runFleetWeek, FLEET_DEPOTS} from "./fleetweek.js";
export {replayFleetActions} from "./fleetweek-benchmark.js";

export function uncertaintyReferences({current, override, overnight, previous}) {
  return {rl:makeUncertaintyPolicy(current,override), planner:chooseFleetPlanner, override:makeOverridePolicy(override),
    meanOnly:makeUncertaintyPolicy(current,override,{meanOnly:true}), flatRisk:makeUncertaintyPolicy(current,override,{flatRisk:true}),
    overnight:makeOvernightPolicy(overnight), previous:makeFleetPolicy(previous)};
}

const suite = {id:UNCERTAINTY_SUITE, cases:uncertaintyCases, summarize:summarizeUncertainty, references:UNCERTAINTY_REFERENCES};
export const benchmarkUncertainty = options => benchmarkFleetSuite(suite, options);
export const verifyUncertaintyReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
