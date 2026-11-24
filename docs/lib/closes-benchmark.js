import { createFreightBenchmark } from "./freight-benchmark.js";
import { adaptivePlanner, CLOSES_PATTERNS, CLOSES_SUITE, closesCases, createCloses,
  observeCloses, stepCloses, stochasticPlanner, verifyCloses } from "./closes.js";
import { chooseCloses } from "./closes-policy.js";
import { chooseDrift } from "./drift-policy.js";
import { chooseTurns } from "./turns-policy.js";

export const CLOSES_REPORT = "evalsim-closes-report-v1";
export const CLOSES_EVALUATION_SPLITS = Object.freeze(["validation", "test", "retention"]);
export const closesReferences = weights => ({
  rl: observation => chooseCloses(observation, weights.closes),
  ablated: observation => chooseCloses(observation, weights.ablated),
  turns: observation => chooseTurns(observation, weights.turns),
  drift: observation => chooseDrift(observation, weights.drift),
  stochastic: stochasticPlanner, adaptive: adaptivePlanner,
});

export const { runCase: runClosesCase, benchmark: benchmarkCloses, verifyReport: verifyClosesReport } =
  createFreightBenchmark({
    id: CLOSES_SUITE.id, format: CLOSES_REPORT, cases: closesCases, references: closesReferences,
    splits: CLOSES_EVALUATION_SPLITS, stratum: family => CLOSES_PATTERNS[family].stratum,
    ending: family => CLOSES_PATTERNS[family].ending,
    world: { create: createCloses, observe: observeCloses, step: stepCloses, verify: verifyCloses },
  });
