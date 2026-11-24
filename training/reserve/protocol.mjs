import { RESERVE_BOOTSTRAP } from "../../docs/lib/reserve-policy.js";

// Frozen before fitting or evaluating the first policy.
export const SPEC = Object.freeze({
  method: "Finite-horizon fitted tabular Q-learning from uniformly mixed exploration propensities",
  gamma: 1,
  trainingSeeds: Object.freeze([13, 37, 73, 101, 211]),
  releaseSeed: 13,
  trainSeedsPerFamilyPerRun: 12000,
  explorationMin: 0.10,
  explorationMax: 0.90,
  // Each prefix forms one learning-curve point on the validation split.
  validationPrefixes: Object.freeze([0, 3000, 12000]),
  caseOrder: "seed, then steady/surge/volatile",
  selection: "Report the final fit for all seeds. Publish training seed 13 regardless of validation or test rank.",
  statistic: "Mean net credits per shift",
  uncertainty: "Paired 95% percentile interval over scenario seeds, keeping families together; conditional on the released policy",
  bootstrapDraws: RESERVE_BOOTSTRAP.draws,
  bootstrapSeed: RESERVE_BOOTSTRAP.seed,
});
