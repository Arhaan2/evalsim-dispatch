import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TARIFF_SUITE,TARIFF_VERSION } from "../../docs/lib/tariff.js";
import { tariffWeights,TARIFF_EVALUATION_SPLITS } from "../../docs/lib/tariff-benchmark.js";
import { paidWeights } from "../../docs/lib/paid-benchmark.js";
import { SPEC } from "./protocol.mjs";
import { fitTariff } from "./fit.mjs";
import { evaluateSplit,fitScores,assess } from "./evaluate.mjs";

const source=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const result=name=>"../../docs/data/"+name+"/results.json";
const names=["paid","booking","survey","rally","trust","closes","drift","turns"];
const prior=names.map(k=>JSON.parse(source(result(k))));
const historical=paidWeights(...prior);
const fits=[];
for (const [index,trainingSeed] of SPEC.trainingSeeds.entries()) {
  const {weights,trainingCounts,selection}=await fitTariff(index,trainingSeed,historical);
  fits.push({trainingSeed,weights,trainingCounts,selection});
  console.error("Finished training and train-only selection for seed "+trainingSeed);
}
const release=fits.find(f=>f.trainingSeed===SPEC.releaseSeed);
const checkpoint={trainingSeed:release.trainingSeed,weights:release.weights};
const weights=tariffWeights({checkpoint},...prior);
const runs=fits.map(f=>({trainingSeed:f.trainingSeed,trainingCounts:f.trainingCounts,selection:f.selection,
  validation:fitScores("validation",f.weights),test:fitScores("test",f.weights)}));
const splits={};
for(const split of TARIFF_EVALUATION_SPLITS) {
  splits[split]=await evaluateSplit(split,weights);
  console.error("Scored "+split+" ("+splits[split].cases.length+" priced shifts)");
}
const checks=assess(splits,SPEC.margin);
const hash=createHash("sha256");
for(const path of ["./run.mjs","./fit.mjs","./evaluate.mjs","./protocol.mjs","../protocol.mjs",
  ...["tariff","tariff-policy","tariff-benchmark","paid","paid-policy","paid-benchmark","booking","booking-policy","booking-benchmark",
    "survey","survey-policy","survey-benchmark","rally","rally-policy","rally-benchmark","trust","trust-policy","trust-benchmark",
    "closes","closes-policy","turns","turns-policy","drift","drift-policy","reserve","reserve-policy","freight-benchmark"]
    .map(name=>"../../docs/lib/"+name+".js"),...names.map(result)]) hash.update(path).update(source(path));
const metadata={version:TARIFF_VERSION,suite:TARIFF_SUITE,protocol:SPEC,fingerprint:hash.digest("hex"),checks};
const data={...metadata,checkpoint,runs,splits};
const desk={...metadata,weights,splits:Object.fromEntries(Object.entries(splits).map(([k,s])=>[k,{summary:s.summary,acquisition:s.acquisition}]))};
const folder=new URL("../../docs/data/tariff/",import.meta.url);
if (!process.argv.includes("--check")) mkdirSync(folder,{recursive:true});
for(const [file,output] of [["results.json",data],["desk.json",desk]]) {
  const path=new URL(file,folder);
  if(process.argv.includes("--check")) assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),output);
  else writeFileSync(path,JSON.stringify(output)+"\n");
}
console.log(process.argv.includes("--check")?"Reproduced all five price-conditioned fits, every paired score and the public desk.":JSON.stringify(checks));
