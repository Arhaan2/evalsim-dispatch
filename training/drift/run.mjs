import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { prng } from "../protocol.mjs";
import { SPEC } from "./protocol.mjs";
import {
  adaptivePlanner, createDrift, DRIFT_SUITE, DRIFT_VERSION, driftCases,
  observeDrift, stepDrift, stochasticPlanner, verifyDrift,
} from "../../docs/lib/drift.js";
import { chooseDrift, driftFeatures, driftQ } from "../../docs/lib/drift-policy.js";
import { chooseReserve, pairedReserve, reserveStateKey } from "../../docs/lib/reserve-policy.js";

const artifact = new URL("../../docs/data/drift/results.json", import.meta.url);
const legacyPath = "../../docs/data/reserve/results.json";
const legacyWeights = JSON.parse(readFileSync(new URL(legacyPath, import.meta.url))).checkpoint.weights;
const training = DRIFT_SUITE.splits.train;
const trainingObservation = observeDrift(createDrift({ seed: training.start, family: training.families[0] }));
const { horizon, capacity } = trainingObservation;
const dimension = driftFeatures(trainingObservation).length;
assert.equal(SPEC.seedsPerTrainingFamily * SPEC.trainingSeeds.length, training.count);

function collect(index, trainingSeed) {
  const random = prng(trainingSeed);
  const seedStart = training.start + index * SPEC.seedsPerTrainingFamily;
  const shifts = SPEC.seedsPerTrainingFamily * training.families.length;
  const size = shifts * horizon;
  const x = new Float64Array(size * dimension), actions = new Uint8Array(size);
  const rewards = new Float64Array(size), slots = new Uint8Array(size);
  let row = 0;
  for (let n = 0; n < SPEC.seedsPerTrainingFamily; n++) {
    for (const family of training.families) {
      const state = createDrift({ family, seed: seedStart + n });
      let obs = observeDrift(state);
      const [low, high] = SPEC.exploration;
      const propensity = low + random() * (high - low);
      while (!obs.done) {
        const book = obs.slots > 0 && random() < propensity;
        slots[row] = obs.slots;
        if (obs.slots) x.set(driftFeatures(obs), row * dimension);
        actions[row] = Number(book);
        const next = stepDrift(state, book ? "accept" : "pass");
        rewards[row] = next.net - obs.net;
        obs = next;
        row++;
      }
    }
  }
  assert.equal(row, size);
  return { x, actions, rewards, slots, size, shifts, seedStart };
}

// Solve empirical ridge normal equations with partial pivoting. The intercept is unpenalized.
function coefficients({ gram, response, count }) {
  if (!count) return null;
  const matrix = gram.map((row, i) => {
    const full = Array.from(row, (_, j) => i >= j ? gram[i][j] : gram[j][i]);
    if (i !== 0) full[i] += count * SPEC.ridge;
    full.push(response[i]);
    return full;
  });
  for (let column = 0; column < dimension; column++) {
    let pivot = column;
    for (let i = column + 1; i < dimension; i++) {
      if (Math.abs(matrix[i][column]) > Math.abs(matrix[pivot][column])) pivot = i;
    }
    assert.ok(Math.abs(matrix[pivot][column]) > 1e-12);
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    for (let i = column + 1; i < dimension; i++) {
      const ratio = matrix[i][column] / matrix[column][column];
      for (let j = column; j <= dimension; j++) matrix[i][j] -= ratio * matrix[column][j];
    }
  }
  const weights = new Array(dimension).fill(0);
  for (let i = dimension - 1; i >= 0; i--) {
    let value = matrix[i][dimension];
    for (let j = i + 1; j < dimension; j++) value -= matrix[i][j] * weights[j];
    weights[i] = value / matrix[i][i];
  }
  return weights.map(w => Number(w.toFixed(SPEC.coefficientDecimals)) || 0);
}

function fit(data) {
  const weights = new Array(horizon);
  for (let wave = horizon - 1; wave >= 0; wave--) {
    const cells = Array.from({ length: capacity + 1 }, () => [0, 1].map(() => ({
      gram: Array.from({ length: dimension }, () => new Float64Array(dimension)),
      response: new Float64Array(dimension), count: 0,
    })));
    for (let row = wave; row < data.size; row += horizon) {
      const slots = data.slots[row];
      if (!slots) continue;
      let target = data.rewards[row];
      if (wave + 1 < horizon && data.slots[row + 1] > 0) {
        const [pass, accept] = weights[wave + 1][data.slots[row + 1]];
        const next = data.x.subarray((row + 1) * dimension, (row + 2) * dimension);
        target += SPEC.discount * Math.max(driftQ(pass, next), driftQ(accept, next));
      }
      const cell = cells[slots][data.actions[row]];
      cell.count++;
      const offset = row * dimension;
      for (let i = 0; i < dimension; i++) {
        const xi = data.x[offset + i];
        cell.response[i] += xi * target;
        for (let j = 0; j <= i; j++) cell.gram[i][j] += xi * data.x[offset + j];
      }
    }
    weights[wave] = cells.map(pair => pair.map(coefficients));
  }
  return weights;
}

function score(config, decide) {
  const state = createDrift(config);
  let obs = observeDrift(state);
  while (!obs.done) obs = stepDrift(state, decide(obs));
  const ledger = verifyDrift(state);
  assert.deepEqual(ledger.violations, []);
  return ledger.net;
}

const mean = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
function byPattern(rows, statistic) {
  const byFamily = {};
  for (const family of new Set(rows.map(r => r.family))) {
    byFamily[family] = statistic(rows.filter(r => r.family === family));
  }
  return { all: statistic(rows), byFamily };
}

const validation = driftCases("validation");
const firstFit = obs => obs.slots ? "accept" : "pass"; // Greedy tie rule with zero coefficients.
const untrainedValidation = byPattern(validation.map(c => ({ ...c, net: score(c, firstFit) })), rows => mean(rows, "net"));
const runs = [], fitted = [];
for (const [i, trainingSeed] of SPEC.trainingSeeds.entries()) {
  const data = collect(i, trainingSeed);
  const weights = fit(data);
  const validationRows = validation.map(c => ({ ...c, net: score(c, o => chooseDrift(o, weights)) }));
  runs.push({
    trainingSeed, shifts: data.shifts, toolCalls: data.size, seedStart: data.seedStart,
    seedEnd: data.seedStart + SPEC.seedsPerTrainingFamily - 1,
    validation: byPattern(validationRows, rows => mean(rows, "net")),
  });
  fitted.push(weights);
}

// Freeze all models before generating or scoring any held-out interaction tape.
const legacyCoverage = { eligibleDecisions: 0, tableHits: 0 };
function legacy(o) {
  if (o.slots) {
    legacyCoverage.eligibleDecisions++;
    if (Object.hasOwn(legacyWeights, reserveStateKey(o))) legacyCoverage.tableHits++;
  }
  return chooseReserve(o, legacyWeights);
}
const cases = driftCases("test").map(({family, seed}) => {
  const c = { family, seed };
  return { ...c, stochastic: score(c, stochasticPlanner), adaptive: score(c, adaptivePlanner), legacy: score(c, legacy) };
});
for (const [i, run] of runs.entries()) {
  const evaluated = cases.map(c => ({ ...c, rl: score(c, o => chooseDrift(o, fitted[i])) }));
  run.test = byPattern(evaluated, rows => mean(rows, "rl"));
  if (run.trainingSeed === SPEC.releaseSeed) {
    for (let j = 0; j < cases.length; j++) cases[j].rl = evaluated[j].rl;
  }
}
const comparisons = byPattern(cases, rows => ({
  count: rows.length, rl: mean(rows, "rl"), stochastic: mean(rows, "stochastic"), adaptive: mean(rows, "adaptive"),
  legacy: mean(rows, "legacy"), rlMinusStochastic: pairedReserve(rows, "rl", "stochastic"),
  rlMinusAdaptive: pairedReserve(rows, "rl", "adaptive"), rlMinusLegacy: pairedReserve(rows, "rl", "legacy"),
}));

// Post-evaluation diagnostics use the simulator's latent odds only here. The
// duplicate rows refer to all eight forecast issues regardless of booked loads.
const quotes = cases.flatMap(config => {
  const state = createDrift(config);
  return state.board.map((quote, wave) => {
    const truth = state.trueHighChances[wave];
    const observed = Number(state.offers[wave].net === quote.high);
    return { family: config.family, absoluteProbabilityError: Math.abs(quote.highChance - truth),
      postedBrier: (quote.highChance - observed) ** 2, trueBrier: (truth - observed) ** 2 };
  });
});
const forecastAudit = byPattern(quotes, rows => ({
  forecasts: rows.length, meanAbsoluteProbabilityError: mean(rows, "absoluteProbabilityError"),
  postedBrier: mean(rows, "postedBrier"), trueBrier: mean(rows, "trueBrier"),
}));

const sourceHash = createHash("sha256");
for (const path of ["../../docs/lib/drift.js", "../../docs/lib/drift-policy.js", "../../docs/lib/reserve.js",
  "../../docs/lib/reserve-policy.js", legacyPath, "../protocol.mjs", "./protocol.mjs", "./run.mjs"]) {
  sourceHash.update(path).update(readFileSync(new URL(path, import.meta.url)));
}
const output = {
  version: DRIFT_VERSION, suite: DRIFT_SUITE, protocol: SPEC, fingerprint: sourceHash.digest("hex"),
  checkpoint: { trainingSeed: SPEC.releaseSeed, weights: fitted[SPEC.trainingSeeds.indexOf(SPEC.releaseSeed)] },
  comparisons, forecastAudit, legacyCoverage, untrainedValidation, runs, cases,
};
if (process.argv.includes("--check")) {
  assert.deepEqual(output, JSON.parse(readFileSync(artifact, "utf8")));
  console.log("Reproduced five Drift Q fits and " + cases.length + " matched held-out scores for four operators.");
} else {
  mkdirSync(new URL(".", artifact), { recursive: true });
  writeFileSync(artifact, JSON.stringify(output) + "\n");
  console.log(JSON.stringify(comparisons, null, 2));
}
