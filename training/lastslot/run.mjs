import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { LASTSLOT_SUITE,LASTSLOT_VERSION } from "../../docs/lib/lastslot.js";
import { lastslotWeights,LASTSLOT_EVALUATION_SPLITS } from "../../docs/lib/lastslot-benchmark.js";
import { tariffWeights } from "../../docs/lib/tariff-benchmark.js";
import { SPEC } from "./protocol.mjs";
import { fitLastslot } from "./fit.mjs";
import { evaluateSplit,fitScores,assess,chooseExamples } from "./evaluate.mjs";

const source=p=>readFileSync(new URL(p,import.meta.url),"utf8"), input=k=>"../../docs/data/"+k+"/results.json";
const names=["tariff","paid","booking","survey","rally","trust","closes","drift","turns"];
const prior=names.map(k=>JSON.parse(source(input(k)))),historical=tariffWeights(...prior);
const folder=new URL("../../docs/data/lastslot/",import.meta.url), check=process.argv.includes("--check");
if(!check) mkdirSync(folder,{recursive:true});
function output(file,data) {
  const path=new URL(file,folder);
  if(check) assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),data);
  else writeFileSync(path,JSON.stringify(data)+"\n");
}
const fits=[];
for(const [index,trainingSeed] of SPEC.trainingSeeds.entries()) {
  const {weights,trainingCounts,selection}=await fitLastslot(index,trainingSeed,historical);
  fits.push({trainingSeed,weights,trainingCounts,selection});
  console.error("Completed fit and training-only selection "+trainingSeed);
}
const release=fits.find(f=>f.trainingSeed===SPEC.releaseSeed);
const checkpoint={trainingSeed:release.trainingSeed,weights:release.weights},weights=lastslotWeights({checkpoint},...prior);
const runs=fits.map(f=>({trainingSeed:f.trainingSeed,trainingCounts:f.trainingCounts,selection:f.selection,
  test:fitScores("test",f.weights,historical)}));
const splits={},banks={};
let examples=[];
for(const split of LASTSLOT_EVALUATION_SPLITS) {
  const {bank,outcome}=evaluateSplit(split,weights);
  output(split+".json",bank);
  if(split==="test") examples=chooseExamples(bank);
  banks[split]=createHash("sha256").update(JSON.stringify(bank)+"\n").digest("hex");
  splits[split]=outcome;
  console.error("Scored "+split+" ("+bank.scores.length+" priced shifts)");
}
const hash=createHash("sha256");
for(const p of ["./run.mjs","./fit.mjs","./evaluate.mjs","./protocol.mjs","../protocol.mjs",
  ...["lastslot","lastslot-policy","lastslot-benchmark","tariff","tariff-policy","tariff-benchmark","paid","paid-policy","paid-benchmark",
  "booking","booking-policy","booking-benchmark","survey","survey-policy","survey-benchmark","rally","rally-policy","rally-benchmark",
  "trust","trust-policy","trust-benchmark","closes","closes-policy","turns","turns-policy","drift","drift-policy","reserve","reserve-policy","freight-benchmark"].map(k=>"../../docs/lib/"+k+".js"),...names.map(input)]) hash.update(p).update(source(p));
const metadata={version:LASTSLOT_VERSION,suite:LASTSLOT_SUITE,protocol:SPEC,checks:assess(splits,SPEC.margin),banks,examples,fingerprint:hash.digest("hex")};
output("results.json",{...metadata,checkpoint,runs,splits});
output("desk.json",{...metadata,weights,splits});
console.log(check?"Reproduced all five specialist fits, the priced ledgers and common one-slot comparisons.":JSON.stringify(metadata.checks));
