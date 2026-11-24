import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { WAITCOST_SUITE,WAITCOST_VERSION } from "../../docs/lib/waitcost.js";
import { waitcostWeights,WAITCOST_EVALUATION_SPLITS } from "../../docs/lib/waitcost-benchmark.js";
import { loadchoiceWeights } from "../../docs/lib/loadchoice-benchmark.js";
import { SPEC } from "./protocol.mjs";
import { fitWaitcost } from "./fit.mjs";
import { evaluateSplit,fitScores,assess,chooseExamples } from "./evaluate.mjs";

const source=p=>readFileSync(new URL(p,import.meta.url),"utf8"), input=k=>"../../docs/data/"+k+"/results.json";
const names=["loadchoice","lastslot","tariff","paid","booking","survey","rally","trust","closes","drift","turns"];
const prior=names.map(k=>JSON.parse(source(input(k)))),historical=loadchoiceWeights(...prior);
const folder=new URL("../../docs/data/waitcost/",import.meta.url), check=process.argv.includes("--check");
if(!check) mkdirSync(folder,{recursive:true});
function output(file,data) {
  const path=new URL(file,folder);
  if(check) assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),data);
  else writeFileSync(path,JSON.stringify(data)+"\n");
}
const fits=[];
for(const [index,trainingSeed] of SPEC.trainingSeeds.entries()) {
  const {weights,trainingCounts,selection}=await fitWaitcost(index,trainingSeed,historical);
  fits.push({trainingSeed,weights,trainingCounts,selection});
  console.error("Completed fit and training-only selection "+trainingSeed);
}
const release=fits.find(f=>f.trainingSeed===SPEC.releaseSeed);
const checkpoint={trainingSeed:release.trainingSeed,weights:release.weights},weights=waitcostWeights({checkpoint},...prior);
const splits={},banks={};
let examples=[],runs=[];
for(const split of WAITCOST_EVALUATION_SPLITS) {
  const {bank,outcome}=evaluateSplit(split,weights);
  output(split+".json",bank);
  if(split==="test") {
    examples=chooseExamples(bank);
    runs=fits.map(f=>({trainingSeed:f.trainingSeed,trainingCounts:f.trainingCounts,selection:f.selection,test:fitScores(f.weights,historical,bank)}));
  }
  banks[split]=createHash("sha256").update(JSON.stringify(bank)+"\n").digest("hex");
  splits[split]=outcome;
  console.error("Scored "+split+" ("+bank.scores.length+" priced shifts)");
}
const hash=createHash("sha256");
// Include every transitive local static import, plus all prior checkpoint inputs.
const visited=new Set();
function hashSource(p) {
  if(visited.has(p)) return;
  visited.add(p);
  const code=source(p);
  hash.update(p).update(code);
  for(const match of code.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+\.(?:mjs|js))["']/g)) {
    hashSource(posix.normalize(posix.join(posix.dirname(p),match[1])));
  }
}
hashSource("run.mjs");
for(const name of names) hash.update(input(name)).update(source(input(name)));
const metadata={version:WAITCOST_VERSION,suite:WAITCOST_SUITE,protocol:SPEC,checks:assess(splits,SPEC.margin),banks,examples,fingerprint:hash.digest("hex")};
output("results.json",{...metadata,checkpoint,runs,splits});
output("desk.json",{...metadata,weights,splits});
console.log(check?"Reproduced all five specialist fits, the guarded and unguarded waits, signed loads and fee-adjusted outcomes.":JSON.stringify(metadata.checks));
