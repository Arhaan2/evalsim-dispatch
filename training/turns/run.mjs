import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { prng } from "../protocol.mjs";
import { SPEC } from "./protocol.mjs";
import {
  adaptivePlanner, createTurns, observeTurns, stepTurns, stochasticPlanner,
  TURNS_PATTERNS, TURNS_SUITE, TURNS_VERSION, turnsCases, verifyTurns,
} from "../../docs/lib/turns.js";
import { createDrift, observeDrift, stepDrift, verifyDrift } from "../../docs/lib/drift.js";
import { chooseDrift } from "../../docs/lib/drift-policy.js";
import { chooseTurns, turnsKeys, turnsSignal, turnsThreshold } from "../../docs/lib/turns-policy.js";
import { pairedReserve } from "../../docs/lib/reserve-policy.js";

const artifact = new URL("../../docs/data/turns/results.json", import.meta.url);
const priorPath = "../../docs/data/drift/results.json";
const prior = JSON.parse(readFileSync(new URL(priorPath, import.meta.url))).checkpoint.weights;
const turnsWorld = { create: createTurns, observe: observeTurns, step: stepTurns, verify: verifyTurns };
const originalWorld = { create: createDrift, observe: observeDrift, step: stepDrift, verify: verifyDrift };
const train = TURNS_SUITE.splits.train;
const { horizon, capacity } = observeTurns(createTurns({ seed: train.start, family: train.families[0] }));
assert.equal(capacity, 2);
assert.equal(train.count, SPEC.seedsPerFit * SPEC.trainingSeeds.length);

// Intern the public feature prefixes so the same market stream can fit both
// estimators and every time step can be backed up on its original next offer.
function collect(trainingSeed, index) {
  const random = prng(trainingSeed);
  const seedStart = train.start + index * SPEC.seedsPerFit;
  const episodes = SPEC.seedsPerFit * train.families.length;
  const encoded = Array.from({ length: horizon }, () => ({
    nodes: [], ids: new Map(), full: new Int32Array(episodes), common: new Int32Array(episodes),
    net: new Float64Array(episodes),
  }));
  function intern(layer, keys, commonDepth) {
    let parent = -1, common;
    for (const [depth, key] of keys.entries()) {
      if (!layer.ids.has(key)) {
        layer.ids.set(key, layer.nodes.length);
        layer.nodes.push({ key, parent, depth });
      }
      parent = layer.ids.get(key);
      if (depth === commonDepth) common = parent;
    }
    return { full: parent, common };
  }
  let row = 0;
  const seen = new Set();
  for (let i = 0; i < SPEC.seedsPerFit; i++) {
    const seed = seedStart + Math.floor(random() * SPEC.seedsPerFit);
    seen.add(seed);
    for (const family of train.families) {
      const state = createTurns({ seed, family });
      let obs = observeTurns(state);
      while (!obs.done) {
        const layer = encoded[obs.wave];
        const keys = turnsKeys(obs, true);
        const ids = intern(layer, keys, turnsKeys(obs, false).length - 1);
        layer.full[row] = ids.full;
        layer.common[row] = ids.common;
        layer.net[row] = obs.offer.net;
        obs = stepTurns(state, "pass");
      }
      row++;
    }
  }
  return { encoded, episodes, seedStart, distinctSeeds: seen.size };
}

const quantize = value => Number(value.toFixed(SPEC.decimals));

function fit({ encoded, episodes }, history) {
  const tables = Array(horizon - 1);
  // After the last signed offer there is no remaining value to waiting.
  let nextOne = new Float64Array(episodes), nextTwo = new Float64Array(episodes);
  for (let t = horizon - 2; t >= 0; t--) {
    const layer = encoded[t], offers = encoded[t + 1].net;
    const groups = history ? layer.full : layer.common;
    const counts = new Uint32Array(layer.nodes.length);
    const one = new Float64Array(counts.length), two = new Float64Array(counts.length);
    for (let i = 0; i < episodes; i++) {
      const id = groups[i], nextOffer = offers[i];
      counts[id]++;
      // The marginal value of the first slot at the next wave is the greater
      // of its offer and its continuation value. The marginal value of a second
      // slot is the next offer bounded by the two continuation estimates.
      one[id] += SPEC.discount * Math.max(nextOffer, nextOne[i]);
      two[id] += SPEC.discount * Math.max(nextTwo[i], Math.min(nextOffer, nextOne[i]));
    }
    for (let id = counts.length - 1; id > 0; id--) {
      const parent = layer.nodes[id].parent;
      counts[parent] += counts[id];
      one[parent] += one[id];
      two[parent] += two[id];
    }
    const table = {};
    for (const [id, node] of layer.nodes.entries()) {
      if (!counts[id]) continue;
      const pseudo = node.parent < 0 ? 0 : SPEC.shrinkage;
      const denominator = counts[id] + pseudo;
      one[id] = quantize((one[id] + pseudo * (one[node.parent] ?? 0)) / denominator);
      two[id] = quantize((two[id] + pseudo * (two[node.parent] ?? 0)) / denominator);
      table[node.key] = [one[id], two[id]];
    }
    tables[t] = table;
    for (let i = 0; i < episodes; i++) {
      nextOne[i] = one[groups[i]];
      nextTwo[i] = two[groups[i]];
    }
  }
  return { history, tables };
}

function run(config, world, decide) {
  const state = world.create(config);
  let obs = world.observe(state);
  while (!obs.done) obs = world.step(state, decide(obs));
  const score = world.verify(state);
  assert.deepEqual(score.violations, []);
  return score.net;
}
const mean = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
function grouped(rows, selector, statistic) {
  const groups = new Map();
  for (const row of rows) {
    const key = selector(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups].map(([key, group]) => [key, statistic(group)]));
}
function summarize(rows) {
  const summary = { count: rows.length, rl: mean(rows, "rl") };
  for (const key of ["stochastic", "adaptive", "drift", "ablated"]) {
    summary[key] = mean(rows, key);
    summary["rlMinus" + key[0].toUpperCase() + key.slice(1)] = pairedReserve(rows, "rl", key);
  }
  return summary;
}
const stratify = r => TURNS_PATTERNS[r.family].stratum;
function fittedScores(cases, weights) {
  const rows = cases.map(c => ({ ...c, rl: run(c, turnsWorld, o => chooseTurns(o, weights)) }));
  return { all: mean(rows, "rl"), byStratum: grouped(rows, stratify, x => mean(x, "rl")) };
}

const validation = turnsCases("validation");
const models = [], runs = [];
for (const [index, trainingSeed] of SPEC.trainingSeeds.entries()) {
  const data = collect(trainingSeed, index);
  const weights = fit(data, true), ablatedWeights = fit(data, false);
  models.push({ trainingSeed, weights, ablatedWeights });
  runs.push({ trainingSeed, seedStart: data.seedStart, distinctSeeds: data.distinctSeeds,
    trainingShifts: data.episodes, trainingCalls: data.episodes * horizon,
    validation: fittedScores(validation, weights), ablatedValidation: fittedScores(validation, ablatedWeights) });
}
const checkpoint = models.find(m => m.trainingSeed === SPEC.releaseSeed);
assert.ok(checkpoint);

// Collect held-out outcomes only after all 10 fits are fixed. Re-running the
// fit after publishing the public suite requires a different holdout claim.
const policies = {
  rl: o => chooseTurns(o, checkpoint.weights), ablated: o => chooseTurns(o, checkpoint.ablatedWeights),
  drift: o => chooseDrift(o, prior), stochastic: stochasticPlanner, adaptive: adaptivePlanner,
};
function comparisonRows(cases, world) {
  return cases.map(({ seed, family }) => {
    const row = { seed, family };
    for (const [name, policy] of Object.entries(policies)) row[name] = run({ seed, family }, world, policy);
    return row;
  });
}
const fresh = turnsCases("test"), cases = comparisonRows(fresh, turnsWorld);
const comparisons = { all: summarize(cases), byFamily: grouped(cases, r => r.family, summarize),
  byStratum: grouped(cases, stratify, summarize) };
const guardConfig = TURNS_SUITE.splits.retention;
const known = Array.from({ length: guardConfig.count }, (_, i) => ({ seed: guardConfig.start + i, family: "interrupted-drop" }));
function diagnostic(configs) {
  const rows = comparisonRows(configs, originalWorld);
  return { cases: rows, comparison: summarize(rows) };
}
const guard = diagnostic(known);
const originalReversal = diagnostic(known.map(c => ({ ...c, family: "reversal" })));
for (const [i, model] of models.entries()) {
  runs[i].test = fittedScores(fresh, model.weights);
  runs[i].ablatedTest = fittedScores(fresh, model.ablatedWeights);
}
const lower = pair => pair.interval95[0];
const retained = pair => lower(pair.rlMinusStochastic) > 0 && lower(pair.rlMinusDrift) > -SPEC.retentionMargin;
const checks = {
  beatsPlanner: lower(comparisons.all.rlMinusStochastic) > 0,
  repairsReversals: lower(comparisons.byStratum.reversal.rlMinusDrift) > 0,
  freshDropRetention: retained(comparisons.byStratum["interrupted-drop"]),
  originalDropRetention: retained(guard.comparison),
};
checks.joint = Object.values(checks).every(Boolean);

// Find actual on-policy contexts with identical current and forecast inputs,
// capacity and clock. Only the signed history may distinguish the decisions.
const contexts = new Map();
for (const config of fresh) {
  run(config, turnsWorld, o => {
    const action = policies.rl(o);
    if (o.slots) {
      const key = JSON.stringify([o.wave, o.slots, o.offer, o.quote, o.forecast]);
      const group = contexts.get(key) ?? { count: 0 };
      group.count++;
      group[action] ??= { seed: config.seed, family: config.family, wave: o.wave, slots: o.slots,
        offer: o.offer.net, threshold: turnsThreshold(o, checkpoint.weights), signal: turnsSignal(o),
        signedHistory: o.history.map(past => past.offer.net), pastQuotes: o.history.map(past => past.quote.highChance) };
      contexts.set(key, group);
    }
    return action;
  });
}
const varied = [...contexts.values()].filter(group => group.pass && group.accept);
const sensitivity = {
  contexts: contexts.size, contextsWithBothActions: varied.length,
  eligibleDecisions: [...contexts.values()].reduce((sum, g) => sum + g.count, 0),
  decisionsInVaryingContexts: varied.reduce((sum, g) => sum + g.count, 0),
  firstExample: varied.length ? { accept: varied[0].accept, pass: varied[0].pass } : null,
};
const hash = createHash("sha256");
for (const path of ["../../docs/lib/turns.js", "../../docs/lib/turns-policy.js", "../../docs/lib/drift.js",
  "../../docs/lib/drift-policy.js", "../../docs/lib/reserve.js", "../../docs/lib/reserve-policy.js",
  priorPath, "../protocol.mjs", "./protocol.mjs", "./run.mjs"]) {
  hash.update(path).update(readFileSync(new URL(path, import.meta.url)));
}
const output = { version: TURNS_VERSION, suite: TURNS_SUITE, protocol: SPEC, fingerprint: hash.digest("hex"),
  checkpoint, comparisons, cases, guard, originalReversal, checks, sensitivity, runs };
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(artifact, "utf8")), output);
  console.log("Reproduced five paired training replicates, " + cases.length + " held-out shifts and both original-pattern diagnostics.");
} else {
  mkdirSync(new URL(".", artifact), { recursive: true });
  writeFileSync(artifact, JSON.stringify(output) + "\n");
  console.log(JSON.stringify({ checks, all: comparisons.all, strata: comparisons.byStratum,
    guard: guard.comparison, originalReversal: originalReversal.comparison, sensitivity }, null, 2));
}
