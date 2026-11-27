import {summarizeLongMove, summarizeLongMoveDurations} from "./longmove-study.js";

export const MOVERECALL_SUITE = "dispatch-moverecall-v1";
export const MOVERECALL_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "shortGate", "longGate", "flatGate", "previous"]);
export const MOVERECALL_SPLITS = Object.freeze(["validation", "test", "clean", "archive"]);
const validation = ["recovery-transfer", "recovery-backtrack"];
const fresh = ["recovery-relay", "recovery-pivot", "recovery-return", "recovery-circuit", "recovery-ramp", "recovery-weave", "recovery-diversion", "recovery-exchange"];
const banks = {
  validation: {families:validation, count:128, start:950000000, starts:[1], durations:[1,2,3,4,4,5,5]},
  test: {families:fresh, count:4096, start:960000000, starts:[3,5], durations:[1,2,3,4,4,4,5,5,5]},
  clean: {families:fresh, count:512, start:970000000},
  archive: {families:["double-return"], count:4096, start:980000000},
};

export function moveRecallCases(split) {
  if (!Object.hasOwn(banks, split)) throw new RangeError("Unknown move-recall bank.");
  const {families, count, start, starts, durations} = banks[split];
  return families.flatMap((family, i) => Array.from({length:count}, (_, n) => ({
    family, seed:start + 10000 * i + n, closure:starts ? {starts:[...starts], durations:[...durations]} : null,
  })));
}

export const summarizeMoveRecall = rows => summarizeLongMove(rows, MOVERECALL_REFERENCES);
export const summarizeMoveRecallDurations = rows => summarizeLongMoveDurations(rows, MOVERECALL_REFERENCES);
