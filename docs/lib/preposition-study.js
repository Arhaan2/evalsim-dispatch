import {loadFleetBank} from "./fleet-bank-loader.js";
import {summarizeLongMove, summarizeLongMoveDurations} from "./longmove-study.js";
import {PREPOSITION_PATTERNS} from "./preposition-markets.js";

export const PREPOSITION_SUITE = "dispatch-preposition-v1";
export const PREPOSITION_SPLITS = Object.freeze(["validation", "test", "clean", "archive"]);
export const PREPOSITION_REFERENCES = Object.freeze(["rl", "planner", "flatRisk", "shortGate", "previous", "warningPlanner", "untrained"]);
const families = Object.keys(PREPOSITION_PATTERNS);
const banks = {
  validation:{families:families.slice(0,2), count:128, start:1250000000, starts:[2,4,6], durations:[1,2,3,4,5]},
  test:{families:families.slice(2), count:4096, start:1260000000, starts:[3,5,7], durations:[1,2,3,4,4,4,5,5,5]},
  clean:{families:families.slice(2), count:512, start:1270000000},
  archive:{families:["double-return"], count:4096, start:1280000000},
};
export function prepositionCases(split) {
  if (!Object.hasOwn(banks,split)) throw new RangeError("Unknown preposition bank.");
  const {families, count, start, starts, durations} = banks[split];
  return families.flatMap((family,i) => Array.from({length:count},(_,j)=>({
    family, seed:start+10000*i+j, closure:starts ? {starts:[...starts], durations:[...durations]} : null,
  })));
}

export const summarizePreposition = rows => summarizeLongMove(rows, PREPOSITION_REFERENCES);
export const summarizePrepositionDurations = rows => summarizeLongMoveDurations(rows, PREPOSITION_REFERENCES);

export function loadPrepositionBank(split,readVerifiedJSON,bankHash,indices) {
  return loadFleetBank(PREPOSITION_SUITE,banks,split,readVerifiedJSON,bankHash,indices);
}
export {fleetTestShard as prepositionTestShard} from "./fleet-bank-loader.js";
