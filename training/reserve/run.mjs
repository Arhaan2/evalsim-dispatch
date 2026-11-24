import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { prng } from "../protocol.mjs";
import { SPEC } from "./protocol.mjs";
import {
  RESERVE_VERSION, createReserve, observeReserve, pointPlanner, stepReserve,
  stochasticPlanner, verifyReserve,
} from "../../docs/lib/reserve.js";
import {
  RESERVE_SUITE, chooseReserve, reserveCases, reserveStateKey, summarizeReserve,
} from "../../docs/lib/reserve-policy.js";

const validation = reserveCases("validation");
const test = reserveCases("test");
const artifact = new URL("../../docs/data/reserve/results.json", import.meta.url);
const firstFit = obs => obs.slots > 0 ? "accept" : "pass";

function score(config, decide) {
  const state = createReserve(config);
  let obs = observeReserve(state);
  while (!obs.done) obs = stepReserve(state, decide(obs));
  const result = verifyReserve(state);
  assert.deepEqual(result.violations, []);
  return result.net;
}

function means(rows, column) {
  const mean = sample => sample.reduce((sum, row) => sum + row[column], 0) / sample.length;
  return {
    all: mean(rows),
    byFamily: Object.fromEntries(RESERVE_SUITE.families.map(family =>
      [family, mean(rows.filter(row => row.family === family))])),
  };
}

// Replay contains sampled public (observation, action, reward, next observation)
// transitions. No planner, forecast probabilities as a simulator, hidden offers,
// or counterfactual actions are used to construct TD targets.
function trainingData(index, trainingSeed) {
  const random = prng(trainingSeed);
  const keys = [], ids = new Map(), layers = [];
  const seedStart = RESERVE_SUITE.splits.train.start + index * SPEC.trainSeedsPerFamilyPerRun;
  function stateId(obs) {
    if (obs.done || !obs.slots) return -1;
    const key = reserveStateKey(obs);
    if (!ids.has(key)) {
      ids.set(key, keys.length);
      keys.push(key);
    }
    return ids.get(key);
  }
  let seedsPerFamily = 0, toolCalls = 0, shifts = 0;
  function collectUntil(limit) {
    for (; seedsPerFamily < limit; seedsPerFamily++) {
      const seed = seedStart + seedsPerFamily;
      for (const family of RESERVE_SUITE.families) {
        const state = createReserve({ seed, family });
        const propensity = SPEC.explorationMin + (SPEC.explorationMax - SPEC.explorationMin) * random();
        let obs = observeReserve(state), id = stateId(obs);
        while (!obs.done) {
          const action = obs.slots > 0 && random() < propensity ? 1 : 0;
          const next = stepReserve(state, action ? "accept" : "pass"), nextId = stateId(next);
          if (id >= 0) {
            const layer = layers[obs.wave] ??= [];
            layer.push([id, action, next.net - obs.net, nextId]);
          }
          obs = next;
          id = nextId;
          toolCalls++;
        }
        shifts++;
      }
    }
  }
  function fit() {
    const table = Array.from({ length: keys.length }, () => [null, null]);
    // Finite-horizon fitted Q iteration: label observed transitions using the
    // frozen next-wave table, then fit each legal state-action cell by its mean.
    for (let wave = layers.length - 1; wave >= 0; wave--) {
      const sums = new Map();
      for (const [id, action, reward, nextId] of layers[wave]) {
        const nextValues = nextId < 0 ? [] : table[nextId].filter(v => v !== null);
        const continuation = nextValues.length ? Math.max(...nextValues) : 0;
        const cell = 2 * id + action;
        const accumulator = sums.get(cell) ?? { sum: 0, count: 0 };
        accumulator.sum += reward + SPEC.gamma * continuation;
        accumulator.count++;
        sums.set(cell, accumulator);
      }
      for (const [cell, { sum, count }] of sums) table[Math.floor(cell / 2)][cell % 2] = sum / count;
    }
    return Object.fromEntries(keys.map((key, id) => [key, table[id]]));
  }
  return { collectUntil, fit, counts: () => ({ shifts, toolCalls, seedStart, seedEnd: seedStart + seedsPerFamily - 1 }) };
}

function fingerprint() {
  const hash = createHash("sha256");
  for (const path of ["../../docs/lib/reserve.js", "../../docs/lib/reserve-policy.js", "../protocol.mjs", "./protocol.mjs", "./run.mjs"]) {
    hash.update(path).update(readFileSync(new URL(path, import.meta.url)));
  }
  return hash.digest("hex");
}

const runs = [], weightsBySeed = new Map();
for (const [index, trainingSeed] of SPEC.trainingSeeds.entries()) {
  const dataset = trainingData(index, trainingSeed), validationCurve = [];
  for (const prefix of SPEC.validationPrefixes) {
    dataset.collectUntil(prefix);
    const weights = dataset.fit();
    const rows = validation.map(config => ({ family: config.family, rl: score(config, obs => chooseReserve(obs, weights)) }));
    validationCurve.push({ seedsPerFamily: prefix, ...means(rows, "rl") });
    if (prefix === SPEC.trainSeedsPerFamilyPerRun) weightsBySeed.set(trainingSeed, weights);
  }
  runs.push({ trainingSeed, ...dataset.counts(), validationCurve });
}
assert.equal(weightsBySeed.size, runs.length);

// Only the final frozen policy is evaluated on the test tapes. No policy or
// checkpoint is selected here. All five trained policies get a test row.
const cases = test.map(config => ({
  seed: config.seed, family: config.family,
  planner: score(config, pointPlanner), stochastic: score(config, stochasticPlanner),
  firstFit: score(config, firstFit),
}));
for (const run of runs) {
  const weights = weightsBySeed.get(run.trainingSeed);
  const rows = cases.map(row => ({ ...row, rl: score(row, obs => chooseReserve(obs, weights)) }));
  run.test = means(rows, "rl");
  if (run.trainingSeed === SPEC.releaseSeed) {
    for (let i = 0; i < cases.length; i++) cases[i].rl = rows[i].rl;
  }
}
const output = {
  version: RESERVE_VERSION, suite: RESERVE_SUITE, protocol: SPEC, fingerprint: fingerprint(),
  checkpoint: { trainingSeed: SPEC.releaseSeed, weights: weightsBySeed.get(SPEC.releaseSeed) },
  comparisons: summarizeReserve(cases), firstFit: means(cases, "firstFit"), runs, cases,
};
if (process.argv.includes("--check")) {
  assert.deepEqual(output, JSON.parse(readFileSync(artifact, "utf8")));
  console.log("Reproduced five Reserve Q-learning fits and all 768 held-out paired scores.");
} else {
  mkdirSync(new URL(".", artifact), { recursive: true });
  writeFileSync(artifact, JSON.stringify(output) + "\n");
  console.log(JSON.stringify(output.comparisons, null, 2));
}
