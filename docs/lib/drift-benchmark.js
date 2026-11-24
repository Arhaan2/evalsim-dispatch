import { createFreightBenchmark } from "./freight-benchmark.js";
import { adaptivePlanner, createDrift, DRIFT_SUITE, driftCases, observeDrift, stepDrift, stochasticPlanner, verifyDrift } from "./drift.js";
import { chooseDrift } from "./drift-policy.js";
import { chooseReserve } from "./reserve-policy.js";

export const DRIFT_REPORT = "evalsim-drift-report-v1";
export const driftReferences = weights => ({
  rl: observation => chooseDrift(observation, weights.drift),
  stochastic: stochasticPlanner, adaptive: adaptivePlanner,
  legacy: observation => chooseReserve(observation, weights.legacy),
});
export const { runCase: runDriftCase, benchmark: benchmarkDrift, verifyReport: verifyDriftReport } =
  createFreightBenchmark({
    id: DRIFT_SUITE.id, format: DRIFT_REPORT, cases: driftCases, references: driftReferences,
    world: { create: createDrift, observe: observeDrift, step: stepDrift, verify: verifyDrift },
  });
