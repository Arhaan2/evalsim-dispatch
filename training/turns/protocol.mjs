import { RESERVE_BOOTSTRAP } from "../../docs/lib/reserve-policy.js";

// Freeze before fitting and before running any evaluation on the fresh test or guard.
export const SPEC = Object.freeze({
  method: "Sample-based finite-horizon fitted afterstate Q iteration with hierarchical shrinkage",
  trainingSeeds: Object.freeze([13, 37, 73, 101, 211]),
  releaseSeed: 13, seedsPerFit: 12000, discount: 1, shrinkage: 32, decimals: 6,
  trainingDesign: "Each replicate draws 12,000 market seeds with replacement from its own disjoint 12,000-seed block, crossed with every training pattern. Repeated draws count as training episodes.",
  selection: "One fixed estimator and its matched history ablation. Release seed 13 regardless of validation or test performance.",
  retentionMargin: 1,
  primary: "Lower paired 95% interval endpoint > 0 vs posted stochastic planner, equal mix of fresh test patterns",
  reversalRepair: "Lower paired 95% interval endpoint > 0 vs released Drift RL on fresh reversal stratum",
  retention: "On each of the fresh interrupted-drop stratum and old interrupted-drop generator guard, lower endpoint > 0 vs posted planner and > -1 credit vs Drift RL",
  joint: "All four prespecified checks must pass",
  diagnostics: "Direct reversal comparison with both planners, matched history ablation, original Drift reversal on the guard seeds, and history-sensitive decisions",
  bootstrapDraws: RESERVE_BOOTSTRAP.draws, bootstrapSeed: RESERVE_BOOTSTRAP.seed,
  uncertainty: "Two-sided paired percentile intervals clustered by scenario seed, conditional on patterns and release checkpoint; stratum and diagnostic intervals are unadjusted",
});
