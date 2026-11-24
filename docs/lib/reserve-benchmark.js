import { createFreightBenchmark } from "./freight-benchmark.js";
import { createReserve, observeReserve, pointPlanner, stepReserve, stochasticPlanner, verifyReserve } from "./reserve.js";
import { chooseReserve, reserveCases, RESERVE_SUITE } from "./reserve-policy.js";

export const RESERVE_REPORT = "evalsim-reserve-report-v1";
export const reserveReferences = weights => ({
  rl: observation => chooseReserve(observation, weights),
  planner: pointPlanner, stochastic: stochasticPlanner,
});
export const { runCase: runReserveCase, benchmark: benchmarkReserve, verifyReport: verifyReserveReport } =
  createFreightBenchmark({
    id: RESERVE_SUITE.id, format: RESERVE_REPORT, cases: reserveCases, references: reserveReferences,
    world: { create: createReserve, observe: observeReserve, step: stepReserve, verify: verifyReserve },
  });
