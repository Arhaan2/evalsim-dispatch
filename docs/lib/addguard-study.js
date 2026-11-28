import {loadFleetBank} from "./fleet-bank-loader.js";
import {summarizeLongMove, summarizeLongMoveDurations} from "./longmove-study.js";
import {ADDGUARD_PATTERNS} from "./addguard-markets.js";

export const ADDGUARD_SUITE = "dispatch-addguard-v1";
export const ADDGUARD_SPLITS = Object.freeze(["validation", "test", "clean", "archive"]);
export const ADDGUARD_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "shortGate", "previous", "original"]);
const families = Object.keys(ADDGUARD_PATTERNS);
const banks = {
  validation:{families:families.slice(0,2), count:128, start:1150000000, starts:[1], durations:[1,2,3,4,4,5,5]},
  test:{families:families.slice(2), count:8192, start:1160000000, starts:[3,5], durations:[1,2,3,4,4,4,5,5,5]},
  clean:{families:families.slice(2), count:512, start:1170000000},
  archive:{families:["double-return"], count:4096, start:1180000000},
};
export function addGuardCases(split) {
  if (!Object.hasOwn(banks,split)) throw new RangeError("Unknown add-guard bank.");
  const {families, count, start, starts, durations} = banks[split];
  return families.flatMap((family,i) => Array.from({length:count},(_,j)=>({
    family, seed:start+10000*i+j, closure:starts ? {starts:[...starts], durations:[...durations]} : null,
  })));
}

export const summarizeAddGuard = rows => summarizeLongMove(rows, ADDGUARD_REFERENCES);
export const summarizeAddGuardDurations = rows => summarizeLongMoveDurations(rows, ADDGUARD_REFERENCES);

export function loadAddGuardBank(split,readVerifiedJSON,bankHash,indices) {
  return loadFleetBank(ADDGUARD_SUITE,banks,split,readVerifiedJSON,bankHash,indices);
}
export {fleetTestShard as addGuardTestShard} from "./fleet-bank-loader.js";
