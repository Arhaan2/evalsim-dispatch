import {summarizeFleetReferences} from "./fleetweek-study.js";
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

export const summarizeOverride = rows => summarizeFleetReferences(rows, OVERRIDE_REFERENCES);
