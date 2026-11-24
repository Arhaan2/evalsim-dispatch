import assert from "node:assert/strict";
import { RALLY_PATTERNS, createRally, observeRally, rallyCases, stepRally, verifyRally } from "../../docs/lib/rally.js";
import { rallyDecision } from "../../docs/lib/rally-policy.js";
import { pairedReserve } from "../../docs/lib/reserve-policy.js";

const stratum = row => RALLY_PATTERNS[row.family].stratum;
const ending = row => RALLY_PATTERNS[row.family].ending;
export const mean = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

function grouped(rows, key, transform) {
  const groups = new Map();
  for (const row of rows) {
    const label = key(row);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }
  return Object.fromEntries([...groups].map(([label, values]) => [label, transform(values)]));
}

export function play(config, policy) {
  const state = createRally(config);
  let o = observeRally(state);
  while (!o.done) o = stepRally(state, policy(o));
  const score = verifyRally(state);
  assert.deepEqual(score.violations, []);
  return score.net;
}

export function scoreSplit(split, policies) {
  const cases = rallyCases(split).map(({ seed, family }) => {
    const row = { seed, family };
    for (const [key, policy] of Object.entries(policies)) row[key] = play({ seed, family }, policy);
    return row;
  });
  function summarize(rows) {
    const result = { count: rows.length };
    for (const key of Object.keys(policies)) {
      result[key] = mean(rows, key);
      if (key !== "rl") result["rlMinus" + key[0].toUpperCase() + key.slice(1)] = pairedReserve(rows, "rl", key);
    }
    return result;
  }
  return { cases, comparisons: { all: summarize(cases), byFamily: grouped(cases, r => r.family, summarize),
    byStratum: grouped(cases, stratum, summarize), byEnding: grouped(cases, ending, summarize),
    byStratumEnding: grouped(cases, stratum, rows => grouped(rows, ending, summarize)) } };
}

export function assess(comparisons, guard, margin) {
  const lower = (row, key) => row["rlMinus" + key].interval95[0];
  const guardResult = guard.comparisons.all;
  const result = {
    coldReversals: lower(comparisons.byStratumEnding.reversal.cold, "Stochastic") > 0,
    hotDrops: lower(comparisons.byStratumEnding["interrupted-drop"].hot, "Stochastic") > 0,
    originalDrop: lower(guardResult, "Stochastic") > 0 &&
      ["Trust", "Drift", "Turns"].every(key => lower(guardResult, key) > -margin),
  };
  result.fresh = Object.values(result).every(Boolean);
  return result;
}

// Keep slots open on the probe. Booking never affects a future offer or survey,
// so every model sees the same evidence, including on shifts it would fill early.
export function probe(split, checkpoint) {
  const waves = Array.from({ length: 8 }, () => []);
  const accuracy = (p, truth) => p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(truth));
  for (const config of rallyCases(split)) {
    const truth = Number(RALLY_PATTERNS[config.family].ending === "hot");
    const state = createRally(config);
    let o = observeRally(state);
    while (!o.done) {
      const p = rallyDecision(o, checkpoint.weights).persistence;
      const control = rallyDecision(o, checkpoint.ablatedWeights).persistence;
      for (const forecast of [p, control]) assert.ok(Number.isFinite(forecast) && forecast >= 0 && forecast <= 1, "Invalid persistence forecast");
      waves[o.wave].push({ seed: config.seed, family: config.family, truth, p,
        brier: (p - truth) ** 2, ablatedBrier: (control - truth) ** 2, chanceBrier: 0.25,
        accuracy: accuracy(p, truth), ablatedAccuracy: accuracy(control, truth) });
      o = stepRally(state, "pass");
    }
  }
  function summarize(rows, index) {
    const pFor = truth => mean(rows.filter(r => r.truth === truth), "p");
    return { wave: index + 1, count: rows.length, brier: mean(rows, "brier"), ablatedBrier: mean(rows, "ablatedBrier"),
      accuracy: mean(rows, "accuracy"), ablatedAccuracy: mean(rows, "ablatedAccuracy"),
      pHot: pFor(1), pCold: pFor(0), gainVsChance: pairedReserve(rows, "chanceBrier", "brier"),
      gainVsAblated: pairedReserve(rows, "ablatedBrier", "brier") };
  }
  const byWave = waves.map(summarize);
  const selected = byWave[6];
  return { byWave, byStratum: Object.fromEntries(["reversal","interrupted-drop"].map(key =>
    [key, waves.map((rows, i) => summarize(rows.filter(r => stratum(r) === key), i))])),
    waveSevenPass: selected.gainVsChance.interval95[0] > 0 && selected.gainVsAblated.interval95[0] > 0 };
}
