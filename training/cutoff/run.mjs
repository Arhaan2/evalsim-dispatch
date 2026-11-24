import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { CUTOFF_VERSION, createShift, observeShift, stepShift, planner, noCheck, rewardShift, verifyShift } from "../../docs/lib/cutoff.js";
import { chooseCutoff, distribution, featureNames } from "../../docs/lib/cutoff-policy.js";
import { SPEC, casesFor } from "./protocol.mjs";
import { prng } from "../protocol.mjs";

const zero = () => Array(featureNames.length).fill(0);
const validation = casesFor("validation");
const suite = casesFor("test");
const modes = ["uniform", "progress"];
const artifact = new URL("../../docs/data/cutoff/results.json", import.meta.url);

function rollout(config, act, limit = Infinity) {
  const s = createShift(config);
  let first = null, express = null, inspected = false;
  while (!s.done && s.calls.length < limit) {
    const id = act(observeShift(s));
    first ??= id;
    if (id.startsWith("express-")) express = id;
    if (id === "inspect") inspected = true;
    stepShift(s, id);
  }
  const m = verifyShift(s);
  assert.deepEqual(m.violations, []);
  return { ...m, done: s.done, first, express, inspected, value: rewardShift(m) };
}

function evaluate(cases, act) {
  const records = cases.map(c => rollout(c, act));
  const summarize = rows => ({
    cases: rows.length, successes: rows.filter(x => x.success).length, inspections: rows.filter(x => x.inspected).length,
    onTimeUnits: rows.reduce((n, x) => n + x.onTimeUnits, 0), totalUnits: rows.reduce((n, x) => n + x.totalUnits, 0),
    calls: rows.reduce((n, x) => n + x.calls, 0), spend: rows.reduce((n, x) => n + x.spend, 0),
  });
  const byFamily = Object.fromEntries(SPEC.families.map(f => [f, summarize(records.filter((_, i) => cases[i].family === f))]));
  const decisionPairs = { pairs: 0, inspectedThenSwitchedAndSolvedBoth: 0 };
  for (let i = 0; i < cases.length; i += 2) {
    if (cases[i].family !== "uncertain") continue;
    const [a, b] = records.slice(i, i + 2);
    decisionPairs.pairs++;
    if (a.first === "inspect" && b.first === "inspect" && a.success && b.success && a.express !== b.express)
      decisionPairs.inspectedThenSwitchedAndSolvedBoth++;
  }
  return { ...summarize(records), byFamily, decisionPairs, strictMask: records.map(x => Number(x.success)).join("") };
}

function sample(probabilities, rng) {
  let roll = rng();
  for (let i = 0; i < probabilities.length - 1; i++) {
    roll -= probabilities[i];
    if (roll < 0) return i;
  }
  return probabilities.length - 1;
}

// Estimate the change since the last block on pairs that neither policy practiced on.
// Probe rollouts use only public observations and debit the same 256-call budget as training.
function measureProgress(previous, current, block, seed) {
  let calls = 0;
  const gains = SPEC.families.map((family, f) => {
    let delta = 0;
    for (let i = 0; i < SPEC.probePairsPerFamily; i++) {
      for (const variant of [0, 1]) {
        const config = { family, variant, split: "train", seed: SPEC.probeStart + seed * 1000 + block * 10 + i };
        const before = rollout(config, obs => chooseCutoff(obs, previous));
        const after = rollout(config, obs => chooseCutoff(obs, current));
        delta += Number(after.success) - Number(before.success);
        calls += before.calls + after.calls;
      }
    }
    return delta / (SPEC.probePairsPerFamily * 2);
  });
  const values = gains.map(g => SPEC.explorationFloor + Math.max(0, g));
  const total = values.reduce((x, y) => x + y, 0);
  return { calls, gains, probabilities: values.map(x => x / total) };
}

function trainingRun(seed, mode) {
  const rng = prng(seed), actionRng = prng(seed + 2000), weights = zero(), m = zero(), v = zero();
  let previous = weights.slice(), average = 0, updates = 0, practice = 0, probes = 0, validationCalls = 0, streak = 0, sustained = null;
  const curve = [];
  for (let block = 0; block <= SPEC.blocks; block++) {
    const val = evaluate(validation, o => chooseCutoff(o, weights));
    validationCalls += val.calls;
    const rate = val.successes / validation.length;
    streak = rate >= SPEC.target ? streak + 1 : 0;
    if (streak >= SPEC.consecutiveCheckpoints && sustained === null)
      sustained = { calls: practice + probes, withValidation: practice + probes + validationCalls };
    const row = { calls: practice + probes, practice, probes, validationCalls, validationSuccesses: val.successes };
    curve.push(row);
    if (block === SPEC.blocks) break;
    let budget = SPEC.callsPerBlock;
    const measure = mode === "progress" && block > 0 ? measureProgress(previous, weights, block, seed) :
      { calls: 0, gains: null, probabilities: [0.5, 0.5] };
    previous = weights.slice();
    probes += measure.calls;
    budget -= measure.calls;
    assert(budget > 0, "Probe cost exceeds block budget.");
    row.nextFamilyProbabilities = measure.probabilities;
    row.measuredGains = measure.gains;
    while (budget > 0) {
      const family = SPEC.families[sample(measure.probabilities, rng)];
      const variant = Math.floor(rng() * 2);
      const scenarioSeed = SPEC.trainSeeds[0] + Math.floor(rng() * (SPEC.trainSeeds[1] - SPEC.trainSeeds[0] + 1));
      const gradient = zero();
      const outcome = rollout({ seed: scenarioSeed, family, variant, split: "train" }, obs => {
        const { calls, probabilities, vectors } = distribution(obs, weights);
        const pick = sample(probabilities, actionRng);
        for (let j = 0; j < gradient.length; j++) {
          gradient[j] += vectors[pick][j] - vectors.reduce((sum, x, k) => sum + probabilities[k] * x[j], 0);
        }
        return calls[pick].id;
      }, budget);
      budget -= outcome.calls; practice += outcome.calls;
      if (!outcome.done) continue;
      const advantage = outcome.value - average;
      average += 0.05 * advantage;
      updates++;
      for (let j = 0; j < weights.length; j++) {
        const g = gradient[j] * advantage;
        m[j] = 0.9 * m[j] + 0.1 * g;
        v[j] = 0.999 * v[j] + 0.001 * g * g;
        weights[j] += SPEC.stepSize * (m[j] / (1 - 0.9 ** updates)) / (Math.sqrt(v[j] / (1 - 0.999 ** updates)) + 1e-8);
      }
    }
  }
  assert.equal(practice + probes, SPEC.callsPerBlock * SPEC.blocks);
  return { seed, mode, weights, practice, probes, updates, validationCalls, sustained, curve, final: evaluate(suite, obs => chooseCutoff(obs, weights)) };
}

function fingerprint() {
  const hash = createHash("sha256");
  for (const file of ["../../docs/lib/cutoff.js", "../../docs/lib/cutoff-policy.js", "../protocol.mjs", "./protocol.mjs", "./run.mjs"]) {
    hash.update(file).update(readFileSync(new URL(file, import.meta.url)));
  }
  return hash.digest("hex");
}

// Pair the training replicate, both stock variants and both families. Resample
// scenario seeds and training seeds independently, preserving the pairing across arms.
function pairedInterval(left, right) {
  const rng = prng(90210), draws = [], n = SPEC.testPairsPerFamily;
  const delta = left.map((l, j) => Array.from({ length: n }, (_, i) => {
    let total = 0;
    for (let k = 0; k < 4; k++) total += Number(l[i * 4 + k]) - Number(right[j][i * 4 + k]);
    return total / 4;
  }));
  for (let b = 0; b < SPEC.bootstrapDraws; b++) {
    const sims = Array.from({ length: n }, () => Math.floor(rng() * n));
    let sum = 0;
    for (let j = 0; j < delta.length; j++) {
      const policy = delta[Math.floor(rng() * delta.length)];
      for (const i of sims) sum += policy[i];
    }
    draws.push(sum / (delta.length * n));
  }
  draws.sort((a, b) => a - b);
  const point = delta.flat().reduce((a, x) => a + x, 0) / (n * delta.length);
  return { point, low: draws[Math.floor(0.025 * draws.length)], high: draws[Math.floor(0.975 * draws.length)] };
}

const baselines = { planner: evaluate(suite, planner), noCheck: evaluate(suite, noCheck), untrained: evaluate(suite, o => chooseCutoff(o, zero())) };
const runs = SPEC.trainingSeeds.flatMap(seed => modes.map(mode => trainingRun(seed, mode)));
const checkpoints = Object.fromEntries(modes.map(mode => {
  const run = runs.find(r => r.mode === mode && r.seed === SPEC.reportCheckpointSeed);
  return [mode, { seed: run.seed, weights: run.weights }];
}));
const arm = mode => runs.filter(r => r.mode === mode);
const masks = mode => arm(mode).map(r => r.final.strictMask);
const summary = Object.fromEntries(modes.map(mode => [mode, {
  meanSuccess: arm(mode).reduce((sum, r) => sum + r.final.successes / r.final.cases, 0) / SPEC.trainingSeeds.length,
  sustainedCalls: arm(mode).map(r => r.sustained?.calls ?? null),
  inspectedThenSwitchedAndSolvedBoth: arm(mode).map(r => r.final.decisionPairs.inspectedThenSwitchedAndSolvedBoth),
}]));
const comparisons = { uniformMinusUntrained: pairedInterval(masks("uniform"), runs.filter(r => r.mode === "uniform").map(() => baselines.untrained.strictMask)),
  progressMinusUniform: pairedInterval(masks("progress"), masks("uniform")) };
const output = { version: CUTOFF_VERSION, fingerprint: fingerprint(), protocol: SPEC, featureNames, baselines, checkpoints, summary, comparisons, runs };
if (process.argv.includes("--check")) {
  const published = JSON.parse(readFileSync(artifact, "utf8"));
  // Math.exp and Adam's exponentiation can differ in their last bits on x64 vs ARM64.
  // Compare each learned coefficient, then verify the exact behavior of the published weights.
  function verifyWeights(actual, expected) {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= 1e-12,
      "Retrained coefficient differs from the published checkpoint at index " + i));
  }
  for (const [index, run] of output.runs.entries()) {
    const saved = published.runs[index];
    verifyWeights(run.weights, saved.weights);
    assert.deepEqual(evaluate(suite, obs => chooseCutoff(obs, saved.weights)), run.final);
    run.weights = saved.weights;
  }
  for (const mode of modes) {
    verifyWeights(output.checkpoints[mode].weights, published.checkpoints[mode].weights);
    const chosen = published.runs.find(r => r.mode === mode && r.seed === SPEC.reportCheckpointSeed);
    assert.deepEqual(published.checkpoints[mode].weights, chosen.weights);
    output.checkpoints[mode].weights = published.checkpoints[mode].weights;
  }
  assert.deepEqual(output, published);
  console.log("Reproduced ten cutoff training runs, three baselines, paired decisions and learning-progress probes.");
} else {
  mkdirSync(fileURLToPath(new URL(".", artifact)), { recursive: true });
  writeFileSync(artifact, JSON.stringify(output) + "\n");
  console.log(JSON.stringify({ summary, comparisons }, null, 2));
}
