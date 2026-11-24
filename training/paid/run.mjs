import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PAID_SUITE, PAID_VERSION } from "../../docs/lib/paid.js";
import { paidWeights, PAID_EVALUATION_SPLITS } from "../../docs/lib/paid-benchmark.js";
import { bookingWeights } from "../../docs/lib/booking-benchmark.js";
import { fitPaid } from "./fit.mjs";
import { SPEC } from "./protocol.mjs";
import { evaluateSplit, fitScores, assess } from "./evaluate.mjs";

const source = path => readFileSync(new URL(path, import.meta.url),"utf8");
const previousNames = ["booking","survey","rally","trust","closes","drift","turns"];
const result = name => "../../docs/data/"+name+"/results.json";
const previous = previousNames.map(name => JSON.parse(source(result(name))));
const priors = bookingWeights(...previous);
const fits = [];
for (const [index,trainingSeed] of SPEC.trainingSeeds.entries()) {
  const { weights, trainingCounts, selection } = await fitPaid(index,trainingSeed,priors);
  fits.push({ weights, trainingSeed, trainingCounts, selection });
  console.error("Finished paid-survey fitting and train-only selection for seed "+trainingSeed);
}
// Release and replication checkpoints are fixed before evaluating any public bank.
const release = fits.find(f => f.trainingSeed === SPEC.releaseSeed);
const checkpoint = { trainingSeed:release.trainingSeed, weights:release.weights };
const weights = paidWeights({checkpoint}, ...previous);
const runs = fits.map(f => ({ trainingSeed:f.trainingSeed, trainingCounts:f.trainingCounts, selection:f.selection,
  validation:fitScores("validation",f.weights), test:fitScores("test",f.weights) }));
const splits = {};
for (const split of PAID_EVALUATION_SPLITS) {
  splits[split] = await evaluateSplit(split,weights);
  console.error("Scored "+split+" ("+splits[split].cases.length+" matched shifts)");
}
const checks = assess(splits,SPEC.margin);
const hash = createHash("sha256");
for (const path of ["./run.mjs","./fit.mjs","./evaluate.mjs","./protocol.mjs","../protocol.mjs",
  ...["paid","paid-policy","paid-benchmark","booking","booking-policy","booking-benchmark","survey","survey-policy","survey-benchmark",
    "rally","rally-policy","rally-benchmark","trust","trust-policy","trust-benchmark","closes","closes-policy","turns","turns-policy",
    "drift","drift-policy","reserve","reserve-policy","freight-benchmark"].map(name => "../../docs/lib/"+name+".js"), ...previousNames.map(result)]) {
  hash.update(path).update(source(path));
}
const output = { version:PAID_VERSION,suite:PAID_SUITE,protocol:SPEC,fingerprint:hash.digest("hex"),checkpoint,runs,splits,checks };
const path = new URL(result("paid"),import.meta.url);
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),output);
  console.log("Reproduced all five fits, all paid-survey policies, fees, purchase interventions and five public splits.");
} else {
  mkdirSync(new URL(".",path),{recursive:true});
  writeFileSync(path,JSON.stringify(output)+"\n");
  console.log(JSON.stringify(checks,null,2));
}
