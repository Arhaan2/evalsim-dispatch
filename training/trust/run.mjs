import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TRUST_PATTERNS, TRUST_SUITE, TRUST_VERSION, adaptivePlanner, createTrust, observeTrust,
  stepTrust, stochasticPlanner, trustCases, verifyTrust } from "../../docs/lib/trust.js";
import { TRUST_EXPERTS, chooseTrust, trustDecision } from "../../docs/lib/trust-policy.js";
import { chooseCloses } from "../../docs/lib/closes-policy.js";
import { chooseDrift } from "../../docs/lib/drift-policy.js";
import { chooseTurns } from "../../docs/lib/turns-policy.js";
import { pairedReserve } from "../../docs/lib/reserve-policy.js";
import { SPEC } from "./protocol.mjs";
import { collect, fit } from "./fit.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const resultPath = name => "../../docs/data/" + name + "/results.json";
const experts = Object.fromEntries(["closes", "turns", "drift"].map(name =>
  [name, JSON.parse(read(resultPath(name))).checkpoint.weights]));
const artifact = new URL(resultPath("trust"), import.meta.url);
assert.equal(TRUST_SUITE.splits.train.count, SPEC.trainingSeeds.length * SPEC.blockSize);

function play(config, policy) {
  const s = createTrust(config);
  let o = observeTrust(s);
  while (!o.done) o = stepTrust(s, policy(o));
  const score = verifyTrust(s);
  assert.deepEqual(score.violations, []);
  return score.net;
}

const mean = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
const stratum = r => TRUST_PATTERNS[r.family].stratum;
const ending = r => TRUST_PATTERNS[r.family].ending;
function groupBy(rows, classify, calculate) {
  const groups = new Map();
  for (const row of rows) {
    const id = classify(row);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return Object.fromEntries([...groups].map(([id, subset]) => [id, calculate(subset)]));
}

const variant = w => o => chooseTrust(o, w, experts);
function modelScores(configs, model) {
  const policies = { rl: variant(model.weights), binary: variant(model.binaryWeights), votes: variant(model.votesWeights) };
  const rows = configs.map(c => ({ ...c, ...Object.fromEntries(Object.entries(policies).map(([k, p]) => [k, play(c, p)])) }));
  const scores = subset => Object.fromEntries(Object.keys(policies).map(k => [k, mean(subset, k)]));
  return { all: scores(rows), byStratumEnding: groupBy(rows, stratum, subset => groupBy(subset, ending, scores)) };
}

const validation = trustCases("validation"), models = [], runs = [];
for (const [index, trainingSeed] of SPEC.trainingSeeds.entries()) {
  const data = collect(index, trainingSeed, experts);
  const model = { trainingSeed, weights: fit(data, "full"), binaryWeights: fit(data, "binary"), votesWeights: fit(data, "votes") };
  models.push(model);
  runs.push({ trainingSeed, seedStart: data.start, distinctSeeds: SPEC.seedsPerFit, trainingShifts: data.n,
    effectiveTrainingShifts: data.effectiveShifts, trainingCalls: data.n * data.layers.length,
    validation: modelScores(validation, model) });
}
const checkpoint = models.find(m => m.trainingSeed === SPEC.releaseSeed);
assert.ok(checkpoint);
// All 15 fits are fixed before the first test or guard trajectory is scored.
const releases = { rl: variant(checkpoint.weights), binary: variant(checkpoint.binaryWeights), votes: variant(checkpoint.votesWeights),
  closes: o => chooseCloses(o, experts.closes), stochastic: stochasticPlanner, adaptive: adaptivePlanner,
  drift: o => chooseDrift(o, experts.drift), turns: o => chooseTurns(o, experts.turns) };

function counter() {
  return { steps: 0, capacity: 0, agreement: 0, disagreement: 0,
    onDisagreement: Object.fromEntries(TRUST_EXPERTS.map(k => [k, 0])), coalitions: {} };
}
function record(tally, result) {
  tally.steps++;
  tally[result.status]++;
  if (result.status !== "disagreement") return;
  for (const expert of result.supporters) tally.onDisagreement[expert]++;
  const key = result.supporters.join("+");
  tally.coalitions[key] = (tally.coalitions[key] ?? 0) + 1;
}
const routing = { all: counter(), byStratumEnding: {}, guard: counter(), archive: counter() };
function evaluate(configs, split) {
  return configs.map(({ seed, family }) => {
    const row = { seed, family };
    const group = split === "test" ? routing.all : split === "retention" ? routing.guard : routing.archive;
    let sub;
    if (split === "test") {
      const strata = routing.byStratumEnding[stratum(row)] ??= {};
      sub = strata[ending(row)] ??= counter();
    }
    row.rl = play(row, o => {
      const result = trustDecision(o, checkpoint.weights, experts);
      record(group, result);
      if (sub) record(sub, result);
      return result.action;
    });
    for (const [name, policy] of Object.entries(releases)) if (name !== "rl") row[name] = play({ seed, family }, policy);
    return row;
  });
}

function summarize(rows) {
  const g = { count: rows.length };
  for (const key of Object.keys(releases)) {
    g[key] = mean(rows, key);
    const suffix = key[0].toUpperCase() + key.slice(1);
    if (key !== "rl") g["rlMinus" + suffix] = pairedReserve(rows, "rl", key);
    if (["closes", "stochastic", "drift", "turns"].includes(key)) g["binaryMinus" + suffix] = pairedReserve(rows, "binary", key);
  }
  return g;
}
function evaluateSplit(split) {
  const rows = evaluate(trustCases(split), split);
  return { cases: rows, comparisons: { all: summarize(rows), byFamily: groupBy(rows, r => r.family, summarize),
    byEnding: groupBy(rows, ending, summarize), byStratum: groupBy(rows, stratum, summarize),
    byStratumEnding: groupBy(rows, stratum, subset => groupBy(subset, ending, summarize)) } };
}
const { cases, comparisons } = evaluateSplit("test");
const guard = evaluateSplit("retention"), archive = evaluateSplit("archive");
const fresh = trustCases("test");
for (const [i, model] of models.entries()) runs[i].test = modelScores(fresh, model);

function assess(candidate) {
  const low = (g, key) => g[candidate + "Minus" + key].interval95[0];
  const hot = g => low(g, "Closes") > 0 && low(g, "Stochastic") > -SPEC.margin;
  const reversal = g => low(g, "Stochastic") > 0 && low(g, "Closes") > -SPEC.margin;
  const original = guard.comparisons.byFamily["interrupted-drop"];
  const result = {
    hotDrops: hot(comparisons.byStratumEnding["interrupted-drop"].hot),
    originalDrop: low(original, "Closes") > 0 && low(original, "Stochastic") > 0
      && low(original, "Turns") > -SPEC.margin && low(original, "Drift") > -SPEC.margin,
    reversals: reversal(comparisons.byStratum.reversal),
    archiveHotDrops: hot(archive.comparisons.byStratumEnding["interrupted-drop"].hot),
    archiveReversals: reversal(archive.comparisons.byStratum.reversal),
  };
  result.fresh = result.hotDrops && result.originalDrop && result.reversals;
  result.joint = result.fresh && result.archiveHotDrops && result.archiveReversals;
  return result;
}
const checks = assess("rl"), binaryChecks = assess("binary");
const hash = createHash("sha256");
for (const path of ["./protocol.mjs", "./fit.mjs", "./run.mjs", "../protocol.mjs",
  ...["trust.js", "trust-policy.js", "closes.js", "closes-policy.js", "turns.js", "turns-policy.js", "drift.js",
    "drift-policy.js", "reserve.js", "reserve-policy.js"].map(p => "../../docs/lib/" + p),
  ...["closes", "drift", "turns"].map(resultPath)]) hash.update(path).update(read(path));
const output = { version: TRUST_VERSION, suite: TRUST_SUITE, protocol: SPEC, fingerprint: hash.digest("hex"),
  checkpoint, cases, comparisons, guard, archive, routing, checks, binaryChecks, runs };
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(artifact, "utf8")), output);
  console.log("Refit all 15 routing policies and reproduced " + [cases, guard.cases, archive.cases].map(x => x.length).join("/") + " test, retention and archive outcomes per policy.");
} else {
  mkdirSync(new URL(".", artifact), { recursive: true });
  writeFileSync(artifact, JSON.stringify(output) + "\n");
  console.log(JSON.stringify({ checks, binaryChecks, routing: routing.all }, null, 2));
}
