import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {checkpoints as prepositionCheckpoints} from "../preposition/checkpoints.mjs";
import {hash} from "../fleetweek/score-helpers.mjs";

export const data=new URL("../../docs/data/fridayguard/",import.meta.url);
export const fitSeeds=[73,101,211];
export async function checkpoints() {
  const {weights,hashes,fits:oldFits}=await prepositionCheckpoints();
  const metadata=JSON.parse(await readFile(new URL("../preposition/results.json",data)));
  for(const seed of [101,211]) {
    const f=oldFits.find(f=>f.seed===seed);
    assert.equal(f.sha,metadata.weightHashes[seed]);
    weights["preposition"+seed]=f.model;
    hashes["preposition"+seed+"Hash"]=f.sha;
  }
  const fits=await Promise.all(fitSeeds.map(async seed=>{
    const bytes=await readFile(new URL("fit-"+seed+".json",data));
    const model=JSON.parse(bytes);
    assert.equal(model.seed,seed);
    return {seed,model,sha:hash(bytes)};
  }));
  return {weights,hashes,fits};
}
