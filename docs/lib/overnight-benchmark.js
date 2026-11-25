import {chooseFleetPlanner, chooseFleetGreedy} from "./fleetweek-planner.js";
import {makeFleetPolicy} from "./fleetweek-policy.js";
import {benchmarkFleetSuite, verifyFleetSuite} from "./fleetweek-benchmark.js";
import {makeOvernightPolicy} from "./overnight-policy.js";
import {OVERNIGHT_SUITE, overnightCases, summarizeOvernight} from "./overnight-study.js";

export {OVERNIGHT_SUITE, OVERNIGHT_SPLITS, OVERNIGHT_FAMILIES, overnightCases} from "./overnight-study.js";
export {createFleetWeek, runFleetWeek, FLEET_DEPOTS} from "./fleetweek.js";
export {replayFleetActions} from "./fleetweek-benchmark.js";

export function removeOvernightEmpty(id, epoch) {
  if (epoch % 2 === 0 || epoch === 9) return id;
  return id.split("|").map(code => code.startsWith("E") ? "W" : code).join("|");
}

export function overnightReferences({current, previous}) {
  const rl = makeOvernightPolicy(current);
  return {rl, planner:chooseFleetPlanner, greedy:chooseFleetGreedy, previous:makeFleetPolicy(previous),
    noEmpty:(obs, legal) => removeOvernightEmpty(rl(obs, legal), obs.epoch)};
}

const suite = {id:OVERNIGHT_SUITE, cases:overnightCases, summarize:summarizeOvernight,
  references:["rl","planner","greedy","previous","noEmpty"]};
export const benchmarkOvernight = options => benchmarkFleetSuite(suite, options);
export const verifyOvernightReport = (report, weights, bank) => verifyFleetSuite(suite, report, bank);
