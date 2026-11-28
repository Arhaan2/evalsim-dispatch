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

// The reader checks the SHA-256 of raw bytes before parsing each JSON document.
export async function loadAddGuardBank(split,readVerifiedJSON,bankHash,indices) {
  if (!Object.hasOwn(banks,split)) throw new RangeError("Unknown add-guard bank.");
  const checkDigest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  if (!checkDigest(bankHash)) throw new TypeError("Missing add-guard bank digest.");
  const root = await readVerifiedJSON(split+".json",bankHash);
  const config = banks[split];
  const total=config.count*config.families.length;
  if (indices!==undefined && (!Array.isArray(indices) || indices.some(i=>!Number.isSafeInteger(i) || i<0 || i>=total)))
    throw new RangeError("Invalid add-guard example indices.");
  function validate(bank,count) {
    if (bank?.suite!==ADDGUARD_SUITE || bank.split!==split || !Array.isArray(bank.cases) || bank.cases.length!==count)
      throw new Error("Invalid add-guard case bank.");
  }
  if (split !== "test") {
    validate(root,config.count*config.families.length);
    return root;
  }
  if (root?.suite!==ADDGUARD_SUITE || root.split!==split || !Array.isArray(root.shards) || root.shards.length!==config.families.length)
    throw new Error("Invalid add-guard test manifest.");
  const requested=indices===undefined ? null : new Set(indices.map(i=>Math.floor(i/config.count)));
  const cases = new Array(total);
  for (const [i,shard] of root.shards.entries()) {
    const filename = addGuardTestShard(i);
    const family = config.families[i];
    if (shard.file!==filename || shard.family!==family || shard.weeks!==config.count || !checkDigest(shard.sha256))
      throw new Error("Invalid add-guard shard descriptor.");
    if (requested && !requested.has(i)) continue;
    const part = await readVerifiedJSON(filename,shard.sha256);
    validate(part,config.count);
    if (!part.cases.every((row,j)=>row.family===family && row.seed===config.start+i*10000+j))
      throw new Error("Invalid add-guard shard week order.");
    for (const [j,row] of part.cases.entries()) cases[i*config.count+j]=row;
  }
  return {suite:ADDGUARD_SUITE, split, cases};
}
export function addGuardTestShard(i) {
  return "test-"+String(i+1).padStart(2,"0")+".json";
}
