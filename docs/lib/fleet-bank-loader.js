// The reader checks the SHA-256 of raw bytes before parsing each JSON document.
export async function loadFleetBank(suite, banks, split, readVerifiedJSON, bankHash, indices) {
  if (!Object.hasOwn(banks,split)) throw new RangeError("Unknown fleet bank.");
  const checkDigest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  if (!checkDigest(bankHash)) throw new TypeError("Missing fleet bank digest.");
  const root = await readVerifiedJSON(split+".json",bankHash);
  const config = banks[split];
  const total=config.count*config.families.length;
  if (indices!==undefined && (!Array.isArray(indices) || indices.some(i=>!Number.isSafeInteger(i) || i<0 || i>=total)))
    throw new RangeError("Invalid fleet example indices.");
  function validate(bank,count) {
    if (bank?.suite!==suite || bank.split!==split || !Array.isArray(bank.cases) || bank.cases.length!==count)
      throw new Error("Invalid fleet case bank.");
  }
  if (split !== "test") {
    validate(root,config.count*config.families.length);
    return root;
  }
  if (root?.suite!==suite || root.split!==split || !Array.isArray(root.shards) || root.shards.length!==config.families.length)
    throw new Error("Invalid fleet test manifest.");
  const requested=indices===undefined ? null : new Set(indices.map(i=>Math.floor(i/config.count)));
  const cases = new Array(total);
  for (const [i,shard] of root.shards.entries()) {
    const filename = fleetTestShard(i);
    const family = config.families[i];
    if (shard.file!==filename || shard.family!==family || shard.weeks!==config.count || !checkDigest(shard.sha256))
      throw new Error("Invalid fleet shard descriptor.");
    if (requested && !requested.has(i)) continue;
    const part = await readVerifiedJSON(filename,shard.sha256);
    validate(part,config.count);
    if (!part.cases.every((row,j)=>row.family===family && row.seed===config.start+i*10000+j))
      throw new Error("Invalid fleet shard week order.");
    for (const [j,row] of part.cases.entries()) cases[i*config.count+j]=row;
  }
  return {suite:suite, split, cases};
}
export function fleetTestShard(i) {
  return "test-"+String(i+1).padStart(2,"0")+".json";
}
