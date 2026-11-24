import { createFreightBenchmark } from "./freight-benchmark.js";
import { RALLY_SUITE, RALLY_PATTERNS, rallyCases, createRally, observeRally, stepRally,
  verifyRally, stochasticPlanner, adaptivePlanner } from "./rally.js";
import { chooseRally } from "./rally-policy.js";
import { trustWeights } from "./trust-benchmark.js";
import { chooseTrust } from "./trust-policy.js";
import { chooseCloses } from "./closes-policy.js";
import { chooseDrift } from "./drift-policy.js";
import { chooseTurns } from "./turns-policy.js";

export const RALLY_REPORT = "evalsim-rally-report-v1";
export const RALLY_EVALUATION_SPLITS = Object.freeze(["validation", "test", "retention", "archive"]);

export function rallyWeights(release, trust, closes, drift, turns) {
  return { ...trustWeights(trust, closes, drift, turns),
    rally: release.checkpoint.weights, ablated: release.checkpoint.ablatedWeights };
}

export const rallyReferences = weights => ({
  rl: o => chooseRally(o, weights.rally),
  ablated: o => chooseRally(o, weights.ablated),
  stochastic: stochasticPlanner,
  trust: o => chooseTrust(o, weights.trust, weights),
  closes: o => chooseCloses(o, weights.closes),
  drift: o => chooseDrift(o, weights.drift),
  turns: o => chooseTurns(o, weights.turns),
  adaptive: adaptivePlanner,
});

export const { runCase: runRallyCase, benchmark: benchmarkRally, verifyReport: verifyRallyReport } =
  createFreightBenchmark({
    id: RALLY_SUITE.id, format: RALLY_REPORT, cases: rallyCases, references: rallyReferences,
    splits: RALLY_EVALUATION_SPLITS, stratum: family => RALLY_PATTERNS[family].stratum,
    ending: family => RALLY_PATTERNS[family].ending,
    world: { create: createRally, observe: observeRally, step: stepRally, verify: verifyRally },
  });
