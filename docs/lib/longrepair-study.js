import {summarizeFleetGroup, summarizeFleetReferences} from "./fleetweek-study.js";

export const LONGREPAIR_SUITE = "dispatch-longrepair-v1";
export const LONGREPAIR_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "closure", "flatGate", "shortGate"]);
export const LONGREPAIR_SPLITS = Object.freeze(["validation", "test", "clean", "archive"]);
const validation = ["prolonged-loop", "prolonged-transfer"];
const fresh = ["prolonged-return", "prolonged-relay", "prolonged-backtrack", "prolonged-rally"];
const banks = {
  validation: {families:validation, count:128, start:650000000, starts:[1], durations:[1,2,3,4,4,5,5]},
  test: {families:fresh, count:2048, start:660000000, starts:[3,5], durations:[1,2,3,4,4,4,5,5,5]},
  clean: {families:fresh, count:512, start:670000000},
  archive: {families:["double-return"], count:4096, start:680000000},
};

export function longRepairCases(split) {
  if (!Object.hasOwn(banks, split)) throw new RangeError("Unknown long-repair bank.");
  const {families, count, start, starts, durations} = banks[split];
  return families.flatMap((family, i) => Array.from({length:count}, (_, n) => ({
    family, seed:start + 10000 * i + n, closure:starts ? {starts:[...starts], durations:[...durations]} : null,
  })));
}

function addConstantComparison(group) {
  const c = group.comparisons.flatRisk;
  group.earnsMoreThanFlatRisk = c.net95[0] > 0;
  group.matchesFlatRiskService = c.servicePP >= 0 && c.service95[0] >= 0;
  group.beatsFlatRisk = group.earnsMoreThanFlatRisk && group.matchesFlatRiskService;
  return group;
}

export function summarizeLongRepair(rows, references = LONGREPAIR_REFERENCES) {
  const summary = summarizeFleetReferences(rows, references);
  for (const group of [summary.all, ...Object.values(summary.byFamily)]) addConstantComparison(group);
  return summary;
}

// Only the completed reference ledger supplies duration. Agents never see it before dispatch.
export function summarizeDurations(rows, references = LONGREPAIR_REFERENCES) {
  const group = subset => addConstantComparison(summarizeFleetGroup(subset, references));
  const partition = predicate => group(rows.filter(r => predicate(r.duration)));
  if (!rows.some(r => r.duration > 0)) return {};
  return {
    durationGroups:{short:partition(d => d <= 3), long:partition(d => d >= 4)},
    byDuration:Object.fromEntries(Array.from(new Set(rows.map(r => r.duration))).sort().map(d => [d, partition(k => k === d)])),
  };
}
