import { RESERVE_BOOTSTRAP } from "../../docs/lib/reserve-policy.js";

// Recorded before fitting or evaluating any Drift policy.
export const SPEC = Object.freeze({
  method: "Finite-horizon fitted Q-learning with linear ridge regressions on sampled public transitions",
  trainingSeeds: Object.freeze([13, 37, 73, 101, 211]),
  releaseSeed: 13,
  seedsPerTrainingFamily: 12000,
  exploration: Object.freeze([0.10, 0.90]),
  discount: 1,
  ridge: 0.001,
  priceScale: 32,
  coefficientDecimals: 7,
  primary: "Released Q policy minus the unchanged posted-distribution planner, mean net credits per shift",
  secondary: "Released Q policy minus history-adjusted planner and frozen Reserve v1 Q policy",
  selection: "Evaluate all five final fits. Release the first seed irrespective of its validation or test score.",
  bootstrapDraws: RESERVE_BOOTSTRAP.draws,
  bootstrapSeed: RESERVE_BOOTSTRAP.seed,
  uncertainty: "Paired percentile interval over scenario seeds with patterns kept together, conditional on the released fit",
});
