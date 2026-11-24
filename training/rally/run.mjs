import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { RALLY_PATTERNS, RALLY_SUITE, RALLY_VERSION, rallyCases } from "../../docs/lib/rally.js";
import { chooseRally } from "../../docs/lib/rally-policy.js";
import { rallyWeights, rallyReferences } from "../../docs/lib/rally-benchmark.js";
import { fitRally } from "./fit.mjs";
import { SPEC } from "./protocol.mjs";
import { assess, mean, play, probe, scoreSplit } from "./evaluate.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const resultPath = name => "../../docs/data/" + name + "/results.json";
const baselines = ["trust", "closes", "drift", "turns"].map(name => JSON.parse(read(resultPath(name))));
assert.equal(SPEC.trainingSeeds.length * SPEC.blockSize, RALLY_SUITE.splits.train.count);

function modelScores(configs, weights) {
  const rows = configs.map(config => ({ pattern: RALLY_PATTERNS[config.family],
    rl: play(config, o => chooseRally(o, weights)) }));
  return { all: mean(rows, "rl"), byStratumEnding: Object.fromEntries(["reversal", "interrupted-drop"].map(key =>
    [key, Object.fromEntries(["cold", "hot"].map(ending =>
      [ending, mean(rows.filter(r => r.pattern.stratum === key && r.pattern.ending === ending), "rl")]))])) };
}

const models = SPEC.trainingSeeds.map((trainingSeed, i) => {
  const model = fitRally(i, trainingSeed);
  console.error("Fitted full and current-only agents with seed " + trainingSeed);
  return { trainingSeed, ...model };
});
const chosen = models.find(m => m.trainingSeed === SPEC.releaseSeed);
const checkpoint = { trainingSeed: chosen.trainingSeed, weights: chosen.weights, ablatedWeights: chosen.ablatedWeights };
const policies = rallyReferences(rallyWeights({ checkpoint }, ...baselines));
// At this point the five fits and their controls are fixed, including the published checkpoint.
const validation = rallyCases("validation"), test = rallyCases("test");
const runs = models.map(model => ({ trainingSeed: model.trainingSeed, trainingCounts: model.trainingCounts,
  validation: modelScores(validation, model.weights), test: modelScores(test, model.weights) }));
const { cases, comparisons } = scoreSplit("test", policies);
const guard = scoreSplit("retention", policies), archive = scoreSplit("archive", policies);
const checks = assess(comparisons, guard, SPEC.margin);
const diagnostic = probe("test", checkpoint);
const hash = createHash("sha256");
for (const path of ["./run.mjs", "./evaluate.mjs", "./protocol.mjs", "./fit.mjs", "../protocol.mjs",
  ...["rally.js", "rally-policy.js", "rally-benchmark.js", "trust.js", "trust-benchmark.js", "trust-policy.js",
    "closes.js", "closes-policy.js", "turns.js", "turns-policy.js", "drift.js", "drift-policy.js",
    "reserve.js", "reserve-policy.js"].map(p => "../../docs/lib/" + p),
  ...["trust", "closes", "turns", "drift"].map(resultPath)]) hash.update(path).update(read(path));
const output = { suite: RALLY_SUITE, version: RALLY_VERSION, protocol: SPEC, fingerprint: hash.digest("hex"),
  checkpoint, runs, cases, comparisons, guard, archive, diagnostic, checks };
const path = new URL(resultPath("rally"), import.meta.url);
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), output);
  console.log("Refit all ten policies and reproduced the diagnostic and all " +
    (cases.length + guard.cases.length + archive.cases.length) + " shifts.");
} else {
  mkdirSync(new URL(".", path), { recursive: true });
  writeFileSync(path, JSON.stringify(output) + "\n");
  console.log(JSON.stringify({ checks, waveSeven: diagnostic.byWave[6] }, null, 2));
}
