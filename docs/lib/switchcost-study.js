import {summarizeLongMove, summarizeLongMoveDurations} from "./longmove-study.js";

export const SWITCHCOST_SUITE = "dispatch-switchcost-v1";
export const SWITCHCOST_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "shortGate", "longGate", "flatGate", "previous", "original"]);
export const SWITCHCOST_SPLITS = Object.freeze(["validation", "test", "clean", "archive"]);
const validation = ["cost-circuit", "cost-crossing"];
const fresh = ["cost-pivot", "cost-loop", "cost-turnback", "cost-ramp", "cost-rebound", "cost-weave", "cost-detour", "cost-relay"];
const banks = {
  validation: {families:validation, count:128, start:1050000000, starts:[1], durations:[1,2,3,4,4,5,5]},
  test: {families:fresh, count:4096, start:1060000000, starts:[3,5], durations:[1,2,3,4,4,4,5,5,5]},
  clean: {families:fresh, count:512, start:1070000000},
  archive: {families:["double-return"], count:4096, start:1080000000},
};

export function switchCostCases(split) {
  if (!Object.hasOwn(banks, split)) throw new RangeError("Unknown switch-cost bank.");
  const {families, count, start, starts, durations} = banks[split];
  return families.flatMap((family, i) => Array.from({length:count}, (_, n) => ({
    family, seed:start + 10000 * i + n, closure:starts ? {starts:[...starts], durations:[...durations]} : null,
  })));
}

export const summarizeSwitchCost = rows => summarizeLongMove(rows, SWITCHCOST_REFERENCES);
export const summarizeSwitchCostDurations = rows => summarizeLongMoveDurations(rows, SWITCHCOST_REFERENCES);
