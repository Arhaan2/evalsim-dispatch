import {summarizeFleetReferences} from "./fleetweek-study.js";
import {UNCERTAINTY_FAMILIES} from "./uncertainty-markets.js";

export {UNCERTAINTY_FAMILIES};
export const UNCERTAINTY_SUITE = "dispatch-uncertainty-v1";
export const UNCERTAINTY_SPLITS = Object.freeze(["validation", "test", "archive"]);
export const UNCERTAINTY_REFERENCES = Object.freeze(["rl", "planner", "override", "meanOnly", "flatRisk", "overnight", "previous"]);

const blocks = Object.freeze({
  validation: {start: 350000000, count: 128},
  test: {start: 360000000, count: 2048},
  archive: {start: 370000000, count: 4096},
});

export function uncertaintyCases(split) {
  if (!Object.hasOwn(blocks, split)) throw new RangeError("Unknown uncertainty evaluation split.");
  const {start, count} = blocks[split];
  return UNCERTAINTY_FAMILIES[split].flatMap((family, index) =>
    Array.from({length: count}, (_, offset) => ({family, seed: start + index * 10000 + offset})));
}

export const summarizeUncertainty = rows => summarizeFleetReferences(rows, UNCERTAINTY_REFERENCES);
