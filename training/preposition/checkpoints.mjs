import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {hash} from "../fleetweek/score-helpers.mjs";

export const data = new URL("../../docs/data/preposition/",import.meta.url);
export const fitSeeds = [73,101,211];
export async function checkpoints() {
  async function read(name,digest,seed) {
    const bytes=await readFile(new URL(name,data));
    if (digest) assert.equal(hash(bytes),digest,name+" digest");
    const model=JSON.parse(bytes);
    if (seed!==undefined) assert.equal(model.seed,seed,name+" seed");
    return {model,sha:hash(bytes)};
  }
  const ancestor=(await read("../switchcost/results.json")).model;
  const files={closure:"../closure/model-13.json",override:"../override/model-13.json",uncertainty:"../uncertainty/model-13.json",
    short:"../longrepair/short-13.json",long:"../longrepair/fit-13.json",previous:"../longmove/fit-13.json",
    recall:"../moverecall/fit-13.json",parent:"../switchcost/fit-73.json"};
  const weights={},hashes={};
  for (const [key,file] of Object.entries(files)) {
    const parent=key==="parent";
    const expected=parent ? "b40441315416d9866f032759566f1b8f72bf7280c6ecb57c709a7867f8dfb18c" : ancestor[key+"Hash"];
    assert.match(expected,/^[a-f0-9]{64}$/);
    const loaded=await read(file,expected,parent ? 73 : 13);
    hashes[key+"Hash"]=loaded.sha;
    weights[key]=loaded.model;
  }
  const fits=await Promise.all(fitSeeds.map(async seed=>({seed,...await read("fit-"+seed+".json",null,seed)})));
  return {weights,hashes,fits};
}
