import { RESERVE_BOOTSTRAP } from "../../docs/lib/reserve-policy.js";

export const SPEC = Object.freeze({
  method: "Finite-horizon, sample-based fitted afterstate Q iteration with hierarchical shrinkage",
  trainingSeeds: Object.freeze([13, 37, 73, 101, 211]), releaseSeed: 13,
  seedsPerFit: 12000, shrinkage: 32, decimals: 6, discount: 1, retentionMargin: 1,
  trainingDesign: "Sample 12,000 market seeds with replacement within each replicate's own 12,000-seed block; cross each draw with all training stems and both closings. Fit both estimators to these identical public offer tapes.",
  selection: "Single fixed fitting rule. Release both final seed-13 models irrespective of validation and test scores.",
  inputs: "Both models use the stage, truck count, signed offer and complete currently posted board. The history model further conditions on the latest three previous high/low outcomes, the earlier survey band, and an older high count.",
  reversalPlanner: "On fresh reversals pooled equally across stems and endings, the lower paired 95% confidence bound for history RL minus the released distribution planner must exceed zero.",
  reversalHistory: "On that same reversal set, the lower paired 95% bound for history RL minus the independently refitted no-history model must exceed zero.",
  retention: "On pooled fresh interrupted drops and on EACH of three archived interrupted-drop families using fresh seeds, lower paired bounds must exceed zero against the distribution planner and minus one credit against BOTH previously released RL agents (Turns and Drift).",
  joint: "Require both reversal checks, fresh-drop retention and every archived drop guard to pass. The ending-specific and individual-stem results are descriptive.",
  bootstrapDraws: RESERVE_BOOTSTRAP.draws, bootstrapSeed: RESERVE_BOOTSTRAP.seed,
  uncertainty: "Two-sided paired percentile intervals resample complete scenario seeds including associated stems, hot/cold counterparts and policies. Intervals condition on the released fit and fixed patterns. Diagnostic intervals are unadjusted.",
});
