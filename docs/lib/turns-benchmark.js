import { createFreightBenchmark } from "./freight-benchmark.js";
import { adaptivePlanner, createTurns, observeTurns, stepTurns, stochasticPlanner,
  TURNS_PATTERNS, TURNS_SUITE, turnsCases, verifyTurns } from "./turns.js";
import { chooseTurns } from "./turns-policy.js";
import { chooseDrift } from "./drift-policy.js";

export const TURNS_REPORT = "evalsim-turns-report-v1";
export const TURNS_EVALUATION_SPLITS = Object.freeze(["validation", "test", "retention"]);
export const turnsReferences = weights => ({
  rl: observation => chooseTurns(observation, weights.turns),
  drift: observation => chooseDrift(observation, weights.drift),
  stochastic: stochasticPlanner, adaptive: adaptivePlanner,
});
export const { runCase: runTurnsCase, benchmark: benchmarkTurns, verifyReport: verifyTurnsReport } =
  createFreightBenchmark({
    id: TURNS_SUITE.id, format: TURNS_REPORT, cases: turnsCases, references: turnsReferences,
    splits: TURNS_EVALUATION_SPLITS, stratum: family => TURNS_PATTERNS[family].stratum,
    world: { create: createTurns, observe: observeTurns, step: stepTurns, verify: verifyTurns },
  });
