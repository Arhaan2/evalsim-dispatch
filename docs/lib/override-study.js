import {fleetAverages, pairedFleetComparison} from "./fleetweek-study.js";
import {OVERRIDE_FAMILIES} from "./override-markets.js";

export {OVERRIDE_FAMILIES};
export const OVERRIDE_SUITE = "dispatch-override-v1";
export const OVERRIDE_SPLITS = Object.freeze(["validation", "test", "archive"]);
export const OVERRIDE_REFERENCES = Object.freeze(["rl", "planner", "overnight", "previous", "always", "greedy"]);

const blocks = Object.freeze({
  validation: {start: 250000000, count: 128},
  test: {start: 260000000, count: 1024},
  archive: {start: 270000000, count: 2048},
});

export function overrideCases(split) {
  if (!Object.hasOwn(blocks, split)) throw new RangeError("Unknown override evaluation split.");
  const {start, count} = blocks[split];
  return OVERRIDE_FAMILIES[split].flatMap((family, index) =>
    Array.from({length: count}, (_, offset) => ({family, seed: start + index * 10000 + offset})));
}

function summarizeGroup(rows) {
  const policies = Object.fromEntries(["agent", ...OVERRIDE_REFERENCES].map(key => [key, fleetAverages(rows, key)]));
  const comparisons = Object.fromEntries(OVERRIDE_REFERENCES.map(key => [key, pairedFleetComparison(rows, key)]));
  const {net95, servicePP, service95} = comparisons.planner;
  const earnsMoreThanPlanner = net95[0] > 0;
  const matchesPlannerService = servicePP >= 0 && service95[0] >= 0;
  return {weeks: rows.length, policies, comparisons, earnsMoreThanPlanner, matchesPlannerService,
    beatsPlanner: earnsMoreThanPlanner && matchesPlannerService};
}

export function summarizeOverride(rows) {
  if (!rows.length) throw new RangeError("No weeks to summarize.");
  const groups = Map.groupBy(rows, row => row.family);
  return {all: summarizeGroup(rows), byFamily: Object.fromEntries(
    Array.from(groups, ([family, block]) => [family, summarizeGroup(block)]))};
}
