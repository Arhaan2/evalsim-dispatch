// Stable public benchmark. Seeds are clustered across families in reports.
export const RESERVE_SUITE = Object.freeze({
  id: "dispatch-reserve-v1",
  families: Object.freeze(["steady", "surge", "volatile"]),
  splits: Object.freeze({
    train: Object.freeze({ start: 5100000, count: 60000 }),
    validation: Object.freeze({ start: 6100000, count: 64 }),
    test: Object.freeze({ start: 7100000, count: 256 }),
  }),
});

export function reserveCases(split = "test") {
  if (!Object.hasOwn(RESERVE_SUITE.splits, split)) throw new RangeError("Unknown Reserve split: " + split);
  const { start, count } = RESERVE_SUITE.splits[split];
  return Array.from({ length: count }, (_, i) =>
    RESERVE_SUITE.families.map(family => ({ split, seed: start + i, family }))).flat();
}

// The key contains only the signed net offer, remaining capacity and public bulletin.
// The suffix length supplies the finite-horizon stage without a family identifier.
export function reserveStateKey(observation) {
  const forecast = observation.forecast.map(f => [f.low, f.high, f.highChance].join("/")).join(",");
  return [observation.slots, observation.offer.net, forecast].join("|");
}

// Table columns are [Q(pass), Q(accept)]. An observed action is preferred to an
// unobserved (null) entry. Ties and entirely unseen observations use first fit.
export function chooseReserve(observation, weights) {
  if (observation.done) return null;
  if (observation.slots === 0) return "pass";
  const values = weights[reserveStateKey(observation)];
  if (!values || values[0] === null) return "accept";
  if (values[1] === null) return "pass";
  return values[1] >= values[0] ? "accept" : "pass";
}

export const RESERVE_BOOTSTRAP = Object.freeze({ draws: 2000, seed: 613 });

// Each resampled unit is a whole scenario seed, preserving the cross-family
// correlation in the public suite and the paired operator decisions on each tape.
export function pairedReserve(rows, candidateKey, referenceKey) {
  if (!rows.length) throw new RangeError("At least one paired Reserve shift is required.");
  const clusters = new Map();
  let wins = 0, ties = 0, losses = 0, total = 0;
  for (const row of rows) {
    const a = row[candidateKey], b = row[referenceKey];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isSafeInteger(row.seed)) {
      throw new TypeError("Each pair needs a seed and two finite scores.");
    }
    const difference = a - b;
    if (difference > 0) wins++;
    else if (difference < 0) losses++;
    else ties++;
    const cluster = clusters.get(row.seed) ?? { sum: 0, n: 0 };
    cluster.sum += difference;
    cluster.n++;
    clusters.set(row.seed, cluster);
    total += difference;
  }
  const groups = [...clusters].sort(([a], [b]) => a - b).map(([, group]) => group);
  let randomState = RESERVE_BOOTSTRAP.seed;
  const draws = [];
  for (let k = 0; k < RESERVE_BOOTSTRAP.draws; k++) {
    let sum = 0, n = 0;
    for (let j = 0; j < groups.length; j++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      const group = groups[Math.floor(randomState / 4294967296 * groups.length)];
      sum += group.sum;
      n += group.n;
    }
    draws.push(sum / n);
  }
  draws.sort((a, b) => a - b);
  return {
    delta: total / rows.length,
    interval95: [draws[Math.floor(draws.length * 0.025)], draws[Math.ceil(draws.length * 0.975) - 1]],
    wins, ties, losses,
  };
}

export function summarizeReserve(rows) {
  const summarize = sample => {
    const mean = key => sample.reduce((sum, row) => sum + row[key], 0) / sample.length;
    return {
      count: sample.length, rl: mean("rl"), planner: mean("planner"), stochastic: mean("stochastic"),
      rlMinusPlanner: pairedReserve(sample, "rl", "planner"),
      rlMinusStochastic: pairedReserve(sample, "rl", "stochastic"),
    };
  };
  const byFamily = {};
  for (const family of RESERVE_SUITE.families) {
    const sample = rows.filter(row => row.family === family);
    if (sample.length) byFamily[family] = summarize(sample);
  }
  return { all: summarize(rows), byFamily };
}
