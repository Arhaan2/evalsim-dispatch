import {summarizeLongRepair, summarizeDurations} from "./longrepair-study.js";

export const SHORTDEFAULT_SUITE = "dispatch-shortdefault-v1";
export const SHORTDEFAULT_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "shortGate", "longGate", "flatGate"]);
export const SHORTDEFAULT_SPLITS = Object.freeze(["validation", "test", "clean", "archive"]);
const validation = ["handoff-circuit", "handoff-switch"];
const fresh = ["handoff-homebound", "handoff-relay", "handoff-detour", "handoff-turnback"];
const banks = {
  validation: {families:validation, count:128, start:750000000, starts:[1], durations:[1,2,3,4,4,5,5]},
  test: {families:fresh, count:4096, start:760000000, starts:[3,5], durations:[1,2,3,4,4,4,5,5,5]},
  clean: {families:fresh, count:512, start:770000000},
  archive: {families:["double-return"], count:4096, start:780000000},
};

export function shortDefaultCases(split) {
  if (!Object.hasOwn(banks, split)) throw new RangeError("Unknown short-default bank.");
  const {families, count, start, starts, durations} = banks[split];
  return families.flatMap((family, i) => Array.from({length:count}, (_, n) => ({
    family, seed:start + 10000 * i + n, closure:starts ? {starts:[...starts], durations:[...durations]} : null,
  })));
}

export const summarizeShortDefault = rows => summarizeLongRepair(rows, SHORTDEFAULT_REFERENCES);
export const summarizeShortDefaultDurations = rows => summarizeDurations(rows, SHORTDEFAULT_REFERENCES);
