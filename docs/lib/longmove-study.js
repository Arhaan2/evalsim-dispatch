import {summarizeLongRepair, summarizeDurations} from "./longrepair-study.js";

export const LONGMOVE_SUITE = "dispatch-longmove-v1";
export const LONGMOVE_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "shortGate", "longGate", "flatGate"]);
export const LONGMOVE_SPLITS = Object.freeze(["validation", "test", "clean", "archive"]);
const validation = ["signal-loop", "signal-switch"];
const fresh = ["signal-rebound", "signal-crossing", "signal-connector", "signal-homebound"];
const banks = {
  validation: {families:validation, count:128, start:850000000, starts:[1], durations:[1,2,3,4,4,5,5]},
  test: {families:fresh, count:4096, start:860000000, starts:[3,5], durations:[1,2,3,4,4,4,5,5,5]},
  clean: {families:fresh, count:512, start:870000000},
  archive: {families:["double-return"], count:4096, start:880000000},
};

export function longMoveCases(split) {
  if (!Object.hasOwn(banks, split)) throw new RangeError("Unknown long-move bank.");
  const {families, count, start, starts, durations} = banks[split];
  return families.flatMap((family, i) => Array.from({length:count}, (_, n) => ({
    family, seed:start + 10000 * i + n, closure:starts ? {starts:[...starts], durations:[...durations]} : null,
  })));
}

function compareShort(group) {
  const {net95,servicePP,service95} = group.comparisons.shortGate;
  group.earnsMoreThanShortGate = net95[0]>0;
  group.matchesShortGateService = servicePP>=0 && service95[0]>=0;
  group.beatsShortGate = group.earnsMoreThanShortGate && group.matchesShortGateService;
}
export function summarizeLongMove(rows, references = LONGMOVE_REFERENCES) {
  const summary = summarizeLongRepair(rows, references);
  for (const group of [summary.all,...Object.values(summary.byFamily)]) compareShort(group);
  return summary;
}
export function summarizeLongMoveDurations(rows, references = LONGMOVE_REFERENCES) {
  const summary = summarizeDurations(rows, references);
  for (const group of [...Object.values(summary.durationGroups ?? {}),...Object.values(summary.byDuration ?? {})]) compareShort(group);
  return summary;
}
