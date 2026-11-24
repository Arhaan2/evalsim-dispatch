import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SURVEY_SUITE, SURVEY_VERSION } from "../../docs/lib/survey.js";
import { surveyWeights } from "../../docs/lib/survey-benchmark.js";
import { fitSurvey } from "./fit.mjs";
import { SPEC } from "./protocol.mjs";
import { assess, decisionAudit, diagnose, scoreSplit, seedScores } from "./evaluate.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const resultPath = name => "../../docs/data/" + name + "/results.json";
const priorNames = ["rally","trust","closes","drift","turns"];
const previous = priorNames.map(k => JSON.parse(read(resultPath(k))));
assert.equal(SURVEY_SUITE.splits.train.count, SPEC.trainingSeeds.length * SPEC.blockSize);
const models = SPEC.trainingSeeds.map((trainingSeed,i) => {
  const fit = fitSurvey(i,trainingSeed);
  console.error("Trained reliability policy and both controls for seed " + trainingSeed);
  return { trainingSeed, ...fit };
});
// Freeze every fit and the designated release checkpoint before the first evaluation trajectory.
const chosen = models.find(m => m.trainingSeed === SPEC.releaseSeed);
const checkpoint = { trainingSeed: chosen.trainingSeed, weights: chosen.weights,
  alwaysWeights: chosen.alwaysWeights, neverWeights: chosen.neverWeights };
const weights = surveyWeights({ checkpoint }, ...previous);
const runs = models.map(m => ({trainingSeed:m.trainingSeed, trainingCounts:m.trainingCounts,
  validation:seedScores("validation",m.weights), test:seedScores("test",m.weights)}));
const { cases, comparisons } = await scoreSplit("test",weights);
const guard = await scoreSplit("retention",weights), archive = await scoreSplit("archive",weights);
const checks = assess(comparisons,guard,SPEC.margin), diagnostic = diagnose("test",weights);
archive.diagnostic = diagnose("archive",weights);
const routing = decisionAudit(weights);
const hash = createHash("sha256");
for (const path of ["./run.mjs", "./fit.mjs", "./evaluate.mjs", "./protocol.mjs", "../protocol.mjs",
  ...["survey","survey-policy","survey-benchmark","rally","rally-policy","rally-benchmark","trust","trust-policy","trust-benchmark",
    "closes","closes-policy","turns","turns-policy","drift","drift-policy","reserve","reserve-policy","freight-benchmark"].map(p => "../../docs/lib/"+p+".js"),
  ...priorNames.map(resultPath)]) hash.update(path).update(read(path));
const output = { suite:SURVEY_SUITE, version:SURVEY_VERSION, fingerprint:hash.digest("hex"), protocol:SPEC, checkpoint,
  runs, cases, comparisons, guard, archive, diagnostic, routing, checks };
const path = new URL(resultPath("survey"),import.meta.url);
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),output);
  console.log("Reproduced all 15 trained policies, " + (cases.length+guard.cases.length+archive.cases.length) + " scored shifts, forecast checks, and survey decisions.");
} else {
  mkdirSync(new URL(".",path),{recursive:true});
  writeFileSync(path,JSON.stringify(output)+"\n");
  console.log(JSON.stringify({checks, calibration:diagnostic.calibrationPass, warning:diagnostic.warningPass},null,2));
}
