import {summarizeFleetReferences} from "./fleetweek-study.js";
import {LOSS_FAMILIES} from "./loss-markets.js";

export {LOSS_FAMILIES};
export const LOSS_SUITE = "dispatch-loss-v1";
export const LOSS_SPLITS = Object.freeze(["validation", "test", "archive"]);
export const LOSS_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "constantLoss", "uncertainty", "override", "previous"]);

const blocks = Object.freeze({
  validation: {start: 450000000, count: 128},
  test: {start: 460000000, count: 2048},
  archive: {start: 470000000, count: 4096},
});

export function lossCases(split) {
  if (!Object.hasOwn(blocks, split)) throw new RangeError("Unknown loss evaluation split.");
  const {start, count} = blocks[split];
  return LOSS_FAMILIES[split].flatMap((family, index) =>
    Array.from({length: count}, (_, offset) => ({family, seed: start + index * 10000 + offset})));
}

export function summarizeLoss(rows) {
  const summary = summarizeFleetReferences(rows, LOSS_REFERENCES);
  for (const group of [summary.all, ...Object.values(summary.byFamily)]) {
    const {net95, servicePP, service95} = group.comparisons.flatRisk;
    group.earnsMoreThanFlatRisk = net95[0] > 0;
    group.matchesFlatRiskService = servicePP >= 0 && service95[0] >= 0;
    group.beatsFlatRisk = group.earnsMoreThanFlatRisk && group.matchesFlatRiskService;
  }
  return summary;
}
