import { createFleetWeek, fleetWeekActions, FLEET_FAMILIES } from "../../docs/lib/fleetweek.js";
import { FLEET_PAIRS, fleetPairIndex, fleetFeatures, fleetContinuation } from "../../docs/lib/fleetweek-policy.js";
import { prng } from "../protocol.mjs";

export const FLEET_FIT = Object.freeze({
  seeds: Object.freeze([13,37,73,101,211]), releaseSeed: 13, weeksPerFamily: 768,
  seedStart: 70000000, seedStride: 100000, ridgePerSample: 0.001, discount: 1,
  algorithm: "Afterstate fitted Q iteration", coefficientDecimals: 8,
});

function collect(seed, index) {
  const families = FLEET_FAMILIES.train, perFamily = FLEET_FIT.weeksPerFamily;
  const weeks = families.length * perFamily, stages = 10, pairs = FLEET_PAIRS.length;
  const seedStart = FLEET_FIT.seedStart + index * FLEET_FIT.seedStride;
  const random = prng(seed);
  const rewards = new Float64Array(weeks * stages * pairs * pairs).fill(-Infinity);
  let features, dimension, actionsExpanded = 0;
  let week = 0;
  for (const family of families) {
    for (let i = 0; i < perFamily; i++, week++) {
      const session = createFleetWeek({family, seed: seedStart + week});
      while (!session.done) {
        const observation = session.observe(), stage = observation.epoch;
        const x = fleetFeatures(observation);
        if (!features) {
          dimension = x.length;
          features = new Float64Array(weeks * stages * dimension);
        }
        const frame = week * stages + stage;
        features.set(x, frame * dimension);
        // Exogenous freight is observable. Holding this public board fixed,
        // enumerate feasible transitions from each possible fleet placement.
        for (const [start, positions] of FLEET_PAIRS.entries()) {
          const offset = (frame * pairs + start) * pairs;
          for (const action of fleetWeekActions({...observation, positions})) {
            const cell = offset + fleetPairIndex(action.positions);
            rewards[cell] = Math.max(rewards[cell], action.net);
            actionsExpanded++;
          }
        }
        const legal = session.legalActions();
        session.step(legal[Math.floor(random() * legal.length)].id);
      }
    }
  }
  return {features, rewards, weeks, stages, dimension, seedStart, actionsExpanded};
}

// All six responses share one positive-definite ridge Gram matrix. The
// intercept is unpenalized. Cholesky gives the same solve for every response.
function ridge(gram, rhs, n) {
  const d = gram.length;
  for (let i = 0; i < d; i++) {
    if (i > 0) gram[i][i] += n * FLEET_FIT.ridgePerSample;
    for (let j = 0; j <= i; j++) {
      let value = gram[i][j];
      for (let k = 0; k < j; k++) value -= gram[i][k] * gram[j][k];
      gram[i][j] = i === j ? Math.sqrt(value) : value / gram[j][j];
    }
  }
  return rhs.map(response => {
    const x = Array.from(response);
    for (let i = 0; i < d; i++) {
      for (let k = 0; k < i; k++) x[i] -= gram[i][k] * x[k];
      x[i] /= gram[i][i];
    }
    for (let i = d - 1; i >= 0; i--) {
      for (let k = i + 1; k < d; k++) x[i] -= gram[k][i] * x[k];
      x[i] /= gram[i][i];
    }
    if (!x.every(Number.isFinite)) throw new Error("Non-finite fleet regression.");
    return x.map(v => Number(v.toFixed(FLEET_FIT.coefficientDecimals)));
  });
}

export function fitAfterstateValues({features, rewards, weeks, stages, dimension}) {
  const pairs = FLEET_PAIRS.length;
  // The closing board has no subsequent earnings or terminal salvage value.
  const weights = new Array(stages).fill(null);
  for (let stage = stages - 2; stage >= 0; stage--) {
    const gram = Array.from({length: dimension}, () => new Float64Array(dimension));
    const rhs = FLEET_PAIRS.map(() => new Float64Array(dimension));
    for (let w = 0; w < weeks; w++) {
      const frame = w * stages + stage, next = frame + 1;
      const x = features.subarray(frame * dimension, next * dimension);
      const nextX = features.subarray(next * dimension, (next + 1) * dimension);
      const future = fleetContinuation(weights[stage + 1], nextX);
      const target = new Float64Array(pairs);
      let total = 0;
      for (let start = 0; start < pairs; start++) {
        let best = -Infinity;
        const offset = (next * pairs + start) * pairs;
        for (let end = 0; end < pairs; end++) {
          best = Math.max(best, rewards[offset + end] + future[end]);
        }
        target[start] = best;
        total += best;
      }
      // Subtract the same board-specific amount from every pair. This removes
      // unpredictable market-wide pay changes while preserving action rankings.
      const mean = total / pairs;
      for (let j = 0; j < dimension; j++) {
        for (let k = 0; k <= j; k++) gram[j][k] += x[j] * x[k];
        for (let p = 0; p < pairs; p++) rhs[p][j] += x[j] * (target[p] - mean);
      }
    }
    weights[stage] = ridge(gram, rhs, weeks);
  }
  return weights;
}

export function fitFleetPolicy(seed) {
  const index = FLEET_FIT.seeds.indexOf(seed);
  if (index < 0) throw new RangeError("Expected a preregistered fleet training seed.");
  const data = collect(seed, index);
  return {
    format: "fleetweek-afterstate-v1", seed, method: FLEET_FIT.algorithm,
    weeks: data.weeks, seedStart: data.seedStart, seedEnd: data.seedStart + data.weeks - 1,
    featureCount: data.dimension, trainingEpochs: data.weeks * data.stages,
    legalTransitions: data.actionsExpanded, weights: fitAfterstateValues(data),
  };
}
