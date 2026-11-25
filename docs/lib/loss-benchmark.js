import {chooseFleetPlanner} from "./fleetweek-planner.js";
import {makeFleetPolicy} from "./fleetweek-policy.js";
import {makeOverridePolicy} from "./override-policy.js";
import {makeUncertaintyPolicy} from "./uncertainty-policy.js";
import {makeLossPolicy} from "./loss-policy.js";
import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {LOSS_SUITE, LOSS_REFERENCES, lossCases, summarizeLoss} from "./loss-study.js";

export {LOSS_SUITE, LOSS_SPLITS, LOSS_FAMILIES, lossCases} from "./loss-study.js";
export {createFleetWeek, runFleetWeek, FLEET_DEPOTS} from "./fleetweek.js";
export {replayFleetActions} from "./fleetweek-benchmark.js";

export function lossReferences({current, previous, override, uncertainty}) {
  return {
    rl: makeLossPolicy(current, override, uncertainty),
    planner: chooseFleetPlanner,
    flatRisk: makeUncertaintyPolicy(uncertainty, override, {flatRisk: true}),
    constantLoss: makeLossPolicy(current, override, uncertainty, {flatLoss: true}),
    uncertainty: makeUncertaintyPolicy(uncertainty, override),
    override: makeOverridePolicy(override),
    previous: makeFleetPolicy(previous),
  };
}

const suite = {id: LOSS_SUITE, cases: lossCases, summarize: summarizeLoss, references: LOSS_REFERENCES};
export const benchmarkLoss = options => benchmarkFleetSuite(suite, options);
export const verifyLossReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
