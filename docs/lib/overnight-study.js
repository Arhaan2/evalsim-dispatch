import { fleetAverages, pairedFleetComparison } from "./fleetweek-study.js";
import { OVERNIGHT_FAMILIES } from "./overnight-markets.js";

export { OVERNIGHT_FAMILIES };
export const OVERNIGHT_SUITE = "dispatch-overnight-v1";
export const OVERNIGHT_SPLITS = Object.freeze(["validation", "test", "archive"]);
const manifest = Object.freeze({
  validation: {count: 128, start: 150000000},
  test: {count: 512, start: 160000000},
  archive: {count: 1024, start: 170000000},
});
const referenceKeys = ["rl", "planner", "greedy", "previous", "noEmpty"];

export function overnightCases(split) {
  if (!Object.hasOwn(manifest, split)) throw new RangeError("Unknown overnight evaluation split.");
  const {count, start} = manifest[split];
  return OVERNIGHT_FAMILIES[split].flatMap((family, index) =>
    Array.from({length: count}, (_, n) => ({family, seed: start + 10000 * index + n})));
}

function section(rows) {
  const policies = Object.fromEntries(["agent", ...referenceKeys].map(k => [k, fleetAverages(rows, k)]));
  const comparisons = Object.fromEntries(referenceKeys.map(k => [k, pairedFleetComparison(rows, k)]));
  const {net95, servicePP, service95} = comparisons.planner;
  const earnsMoreThanPlanner = net95[0] > 0;
  const matchesPlannerService = servicePP >= 0 && service95[0] >= 0;
  return {weeks: rows.length, policies, comparisons, earnsMoreThanPlanner, matchesPlannerService,
    beatsPlanner: earnsMoreThanPlanner && matchesPlannerService};
}

export function summarizeOvernight(rows) {
  if (!rows.length) throw new RangeError("No weeks to summarize.");
  const families = [...new Set(rows.map(row => row.family))];
  return {all: section(rows), byFamily: Object.fromEntries(families.map(family =>
    [family, section(rows.filter(row => row.family === family))]))};
}
