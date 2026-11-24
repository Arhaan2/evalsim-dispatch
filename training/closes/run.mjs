import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { prng } from "../protocol.mjs";
import { SPEC } from "./protocol.mjs";
import { adaptivePlanner, CLOSES_PATTERNS, CLOSES_SUITE, closesCases, createCloses,
  observeCloses, stepCloses, stochasticPlanner, verifyCloses } from "../../docs/lib/closes.js";
import { chooseCloses, extendClosesHistory, publicClosesKeys } from "../../docs/lib/closes-policy.js";
import { chooseTurns } from "../../docs/lib/turns-policy.js";
import { chooseDrift } from "../../docs/lib/drift-policy.js";
import { pairedReserve } from "../../docs/lib/reserve-policy.js";

const artifact = new URL("../../docs/data/closes/results.json", import.meta.url);
const turnsPath = "../../docs/data/turns/results.json";
const driftPath = "../../docs/data/drift/results.json";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const train = CLOSES_SUITE.splits.train;
const { horizon, capacity } = observeCloses(createCloses({ family: train.families[0], seed: train.start }));
assert.equal(capacity, 2);
assert.equal(train.count, SPEC.seedsPerFit * SPEC.trainingSeeds.length);

// Give each distinct public feature prefix a row number. Parents are always
// interned first, so a reverse pass can accumulate the nested group means.
function intern(layer, keys, lastPublic, episode) {
  let parent = -1;
  for (const [i, key] of keys.entries()) {
    if (!layer.index.has(key)) {
      layer.index.set(key, layer.nodes.length);
      layer.nodes.push({ key, parent });
    }
    parent = layer.index.get(key);
    if (i === lastPublic) layer.common[episode] = parent;
  }
  layer.full[episode] = parent;
}

function collect(trainingSeed, index) {
  const draw = prng(trainingSeed);
  const seedStart = train.start + index * SPEC.seedsPerFit;
  const episodes = SPEC.seedsPerFit * train.families.length;
  const layers = Array.from({ length: horizon }, () => ({
    nodes: [], index: new Map(), full: new Uint32Array(episodes), common: new Uint32Array(episodes),
    net: new Float64Array(episodes),
  }));
  const seeds = new Set();
  let episode = 0;
  for (let i = 0; i < SPEC.seedsPerFit; i++) {
    const seed = seedStart + Math.floor(draw() * SPEC.seedsPerFit);
    seeds.add(seed);
    for (const family of train.families) {
      const state = createCloses({ seed, family });
      let o = observeCloses(state);
      while (!o.done) {
        const layer = layers[o.wave];
        layer.net[episode] = o.offer.net;
        if (o.wave < horizon - 1) {
          const keys = publicClosesKeys(o);
          const lastPublic = keys.length - 1;
          extendClosesHistory(keys, o.history);
          intern(layer, keys, lastPublic, episode);
        }
        // Bookings do not change which signed offer is observed next.
        o = stepCloses(state, "pass");
      }
      episode++;
    }
  }
  return { layers, episodes, seedStart, distinctSeeds: seeds.size };
}

function fit({ layers, episodes }, history) {
  const tables = Array(horizon - 1);
  const nextOne = new Float64Array(episodes), nextTwo = new Float64Array(episodes);
  for (let t = tables.length - 1; t >= 0; t--) {
    const layer = layers[t];
    const groups = history ? layer.full : layer.common;
    const count = new Uint32Array(layer.nodes.length);
    const one = new Float64Array(count.length), two = new Float64Array(count.length);
    for (let i = 0; i < episodes; i++) {
      const id = groups[i], offer = layers[t + 1].net[i];
      // Bellman targets for one additional slot and a second additional slot.
      count[id]++;
      one[id] += SPEC.discount * Math.max(offer, nextOne[i]);
      two[id] += SPEC.discount * Math.max(nextTwo[i], Math.min(offer, nextOne[i]));
    }
    for (let id = count.length - 1; id > 0; id--) {
      const parent = layer.nodes[id].parent;
      count[parent] += count[id];
      one[parent] += one[id];
      two[parent] += two[id];
    }
    const table = {};
    for (const [id, node] of layer.nodes.entries()) {
      if (!count[id]) continue;
      const pseudo = node.parent < 0 ? 0 : SPEC.shrinkage;
      const n = count[id] + pseudo;
      one[id] = Number(((one[id] + pseudo * (one[node.parent] ?? 0)) / n).toFixed(SPEC.decimals));
      two[id] = Number(((two[id] + pseudo * (two[node.parent] ?? 0)) / n).toFixed(SPEC.decimals));
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

function play(config, decide) {
  const state = createCloses(config);
  let o = observeCloses(state);
  while (!o.done) o = stepCloses(state, decide(o));
  const score = verifyCloses(state);
  assert.deepEqual(score.violations, []);
  return score.net;
}

function groupBy(rows, group, statistic) {
  const groups = new Map();
  for (const row of rows) {
    const key = group(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups].map(([key, sample]) => [key, statistic(sample)]));
}

const stratum = row => CLOSES_PATTERNS[row.family].stratum;
const ending = row => CLOSES_PATTERNS[row.family].ending;
const mean = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

function fittedScores(configs, weights) {
  const rows = configs.map(c => ({ ...c, rl: play(c, o => chooseCloses(o, weights)) }));
  const score = g => mean(g, "rl");
  return { all: score(rows), byStratum: groupBy(rows, stratum, score), byEnding: groupBy(rows, ending, score) };
}

const validation = closesCases("validation");
const models = [], runs = [];
for (const [index, trainingSeed] of SPEC.trainingSeeds.entries()) {
  const data = collect(trainingSeed, index);
  const weights = fit(data, true), ablatedWeights = fit(data, false);
  models.push({ weights, ablatedWeights, trainingSeed });
  runs.push({ trainingSeed, seedStart: data.seedStart, distinctSeeds: data.distinctSeeds,
    trainingShifts: data.episodes, trainingCalls: data.episodes * horizon,
    validation: fittedScores(validation, weights), ablatedValidation: fittedScores(validation, ablatedWeights) });
}

// All ten estimators are now fixed. The protocol chooses a single training seed.
const checkpoint = models.find(m => m.trainingSeed === SPEC.releaseSeed);
assert.ok(checkpoint);
const oldTurns = JSON.parse(read(turnsPath)).checkpoint.weights;
const oldDrift = JSON.parse(read(driftPath)).checkpoint.weights;
const policies = {
  rl: o => chooseCloses(o, checkpoint.weights), ablated: o => chooseCloses(o, checkpoint.ablatedWeights),
  stochastic: stochasticPlanner, adaptive: adaptivePlanner,
  turns: o => chooseTurns(o, oldTurns), drift: o => chooseDrift(o, oldDrift),
};

function compare(configs) {
  return configs.map(({ seed, family }) => {
    const row = { seed, family };
    for (const [name, decide] of Object.entries(policies)) row[name] = play({ seed, family }, decide);
    return row;
  });
}

function summarize(rows) {
  const summary = { count: rows.length, rl: mean(rows, "rl") };
  for (const key of ["ablated", "stochastic", "adaptive", "turns", "drift"]) {
    summary[key] = mean(rows, key);
    summary["rlMinus" + key[0].toUpperCase() + key.slice(1)] = pairedReserve(rows, "rl", key);
  }
  summary.ablatedMinusStochastic = pairedReserve(rows, "ablated", "stochastic");
  return summary;
}

const fresh = closesCases("test"), cases = compare(fresh);
const comparisons = { all: summarize(cases), byFamily: groupBy(cases, r => r.family, summarize),
  byEnding: groupBy(cases, ending, summarize), byStratum: groupBy(cases, stratum, summarize),
  byStratumEnding: groupBy(cases, stratum, subset => groupBy(subset, ending, summarize)) };
const guardRows = compare(closesCases("retention"));
const guard = { cases: guardRows, comparison: summarize(guardRows), byFamily: groupBy(guardRows, r => r.family, summarize) };
for (const [i, model] of models.entries()) {
  runs[i].test = fittedScores(fresh, model.weights);
  runs[i].ablatedTest = fittedScores(fresh, model.ablatedWeights);
}

function retained(group) {
  return group.rlMinusStochastic.interval95[0] > 0 && group.rlMinusTurns.interval95[0] > -SPEC.retentionMargin
    && group.rlMinusDrift.interval95[0] > -SPEC.retentionMargin;
}
const reversal = comparisons.byStratum.reversal;
const checks = {
  reversalPlanner: reversal.rlMinusStochastic.interval95[0] > 0,
  reversalHistory: reversal.rlMinusAblated.interval95[0] > 0,
  freshDropRetention: retained(comparisons.byStratum["interrupted-drop"]),
  guardRetention: Object.fromEntries(Object.entries(guard.byFamily).map(([family, group]) => [family, retained(group)])),
};
checks.joint = checks.reversalPlanner && checks.reversalHistory && checks.freshDropRetention
  && Object.values(checks.guardRetention).every(Boolean);

const hash = createHash("sha256");
for (const path of ["../../docs/lib/closes.js", "../../docs/lib/closes-policy.js", "../../docs/lib/turns.js",
  "../../docs/lib/turns-policy.js", "../../docs/lib/drift.js", "../../docs/lib/drift-policy.js",
  "../../docs/lib/reserve.js", "../../docs/lib/reserve-policy.js", turnsPath, driftPath,
  "../protocol.mjs", "./protocol.mjs", "./run.mjs"]) hash.update(path).update(read(path));
const output = { version: "closes-v1.0.0", suite: CLOSES_SUITE, protocol: SPEC, fingerprint: hash.digest("hex"),
  checkpoint, cases, comparisons, guard, checks, runs };
if (process.argv.includes("--check")) {
  assert.deepEqual(JSON.parse(readFileSync(artifact, "utf8")), output);
  console.log("Refit all five paired balanced-closes models and reproduced " + cases.length + " fresh and "
    + guardRows.length + " archived shifts.");
} else {
  mkdirSync(new URL(".", artifact), { recursive: true });
  writeFileSync(artifact, JSON.stringify(output) + "\n");
  console.log(JSON.stringify({ checks, reversal: comparisons.byStratum.reversal, drops: comparisons.byStratum["interrupted-drop"] }, null, 2));
}
