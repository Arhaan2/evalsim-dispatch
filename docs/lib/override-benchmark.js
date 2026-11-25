import {chooseFleetGreedy, chooseFleetPlanner} from "./fleetweek-planner.js";
import {makeFleetPolicy} from "./fleetweek-policy.js";
import {makeOvernightPolicy} from "./overnight-policy.js";
import {inspectOverride, makeOverridePolicy} from "./override-policy.js";
import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {OVERRIDE_SUITE, OVERRIDE_REFERENCES, overrideCases, summarizeOverride} from "./override-study.js";

export {OVERRIDE_SUITE, OVERRIDE_SPLITS, OVERRIDE_FAMILIES, overrideCases} from "./override-study.js";
export {createFleetWeek, runFleetWeek, FLEET_DEPOTS} from "./fleetweek.js";
export {replayFleetActions} from "./fleetweek-benchmark.js";

export function overrideReferences({current, overnight, previous}) {
  const always = (obs, menu) => {
    const {proposalId, plannerId} = inspectOverride(obs, menu, current);
    return proposalId ?? plannerId;
  };
  return {rl: makeOverridePolicy(current), planner: chooseFleetPlanner, overnight: makeOvernightPolicy(overnight),
    previous: makeFleetPolicy(previous), always, greedy: chooseFleetGreedy};
}

const suite = {id: OVERRIDE_SUITE, cases: overrideCases, summarize: summarizeOverride, references: OVERRIDE_REFERENCES};
export const benchmarkOverride = options => benchmarkFleetSuite(suite, options);
export const verifyOverrideReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
