import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BOOKING_SUITE, BOOKING_VERSION } from "../../docs/lib/booking.js";
import { bookingWeights } from "../../docs/lib/booking-benchmark.js";
import { surveyWeights } from "../../docs/lib/survey-benchmark.js";
import { fitBooking } from "./fit.mjs";
import { SPEC } from "./protocol.mjs";
import { assess, decisionAudit, scoreSplit, seedScores } from "./evaluate.mjs";

const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
const resultPath = name => "../../docs/data/" + name + "/results.json";
const priorNames = ["survey","rally","trust","closes","drift","turns"];
const previous = priorNames.map(name => JSON.parse(source(resultPath(name))));
const priors = surveyWeights(...previous);
assert.equal(BOOKING_SUITE.splits.train.count, SPEC.trainingSeeds.length * SPEC.blockSize);
const models = SPEC.trainingSeeds.map((trainingSeed,index) => {
  const fit = fitBooking(index, trainingSeed, priors);
  console.error("Finished fitting and train-only selection for seed " + trainingSeed);
  return { trainingSeed, ...fit };
});
// No public evaluation runs before every candidate and release selection is fixed.
const chosen = models.find(m => m.trainingSeed === SPEC.releaseSeed);
const checkpoint = { trainingSeed:chosen.trainingSeed, weights:chosen.weights, equalWeights:chosen.equalWeights };
const weights = bookingWeights({checkpoint}, ...previous);
const runs = models.map(m => ({ trainingSeed:m.trainingSeed, trainingCounts:m.trainingCounts, selection:m.selection,
  validation:seedScores("validation",m.weights,priors), test:seedScores("test",m.weights,priors) }));
const { cases,comparisons } = await scoreSplit("test",weights);
const guard = await scoreSplit("retention",weights);
const archive = await scoreSplit("archive",weights);
const checks = assess(comparisons,guard.comparisons,archive.comparisons,SPEC.margin);
const audit = { test:decisionAudit(cases,weights), retention:decisionAudit(guard.cases,weights),
  archive:decisionAudit(archive.cases,weights) };
const hash = createHash("sha256");
for (const path of ["./run.mjs","./fit.mjs","./evaluate.mjs","./protocol.mjs","../protocol.mjs",
  ...["booking","booking-policy","booking-benchmark","survey","survey-policy","survey-benchmark","rally","rally-policy",
    "rally-benchmark","trust","trust-policy","trust-benchmark","closes","closes-policy","turns","turns-policy","drift",
    "drift-policy","reserve","reserve-policy","freight-benchmark"].map(p => "../../docs/lib/"+p+".js"),
  ...priorNames.map(resultPath)]) hash.update(path).update(source(path));
const output = { suite:BOOKING_SUITE, version:BOOKING_VERSION, protocol:SPEC, fingerprint:hash.digest("hex"), checkpoint,
  runs, cases, comparisons, guard, archive, checks, audit };
const path = new URL(resultPath("booking"),import.meta.url);
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),output);
  console.log("Reproduced all five candidate selections, released policies, 17,408 scored shifts and counterfactual early-booking contributions.");
} else {
  mkdirSync(new URL(".",path),{recursive:true});
  writeFileSync(path,JSON.stringify(output)+"\n");
  console.log(JSON.stringify(checks,null,2));
}
