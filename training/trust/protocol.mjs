import { RESERVE_BOOTSTRAP } from "../../docs/lib/reserve-policy.js";

export const SPEC = Object.freeze({
  method: "Finite-horizon fitted policy iteration on expert disagreements, using counterfactual Monte Carlo returns under the learned downstream gate.",
  trainingSeeds: Object.freeze([13, 37, 73, 101, 211]), releaseSeed: 13,
  blockSize: 12000, seedsPerFit: 6000, hotDropWeight: 2, shrinkage: 32, decimals: 6, margin: 1,
  trainingDesign: "Sample 6,000 distinct seeds without replacement from each fit's own 12,000-seed block. Cross with every training family. Weight training hot interrupted drops twice to emphasize the previous weakness. Three released Turns training-only cold rebounds supplement the balanced training market. Use identical market tapes and weights for all routers.",
  selection: "Prespecified seed 13 and final estimators for all three gate variants, without selection on validation or other splits.",
  experts: "The released Closes history policy, the released distribution planner, and the released Drift history specialist advise on each decision. Agreement and zero capacity fix an action. At disagreement, choose the advised action with higher fitted conditional return. Ties and unsupported table roots follow the planner.",
  controls: "Refit the Closes/planner-only gate under its own downstream action restrictions. Refit the three-expert gate without additional signed history in its gate features. Expert votes can carry history in the latter control.",
  hotDrops: "On fresh hot-ending interrupted drops, lower paired 95% bounds must exceed zero against Closes and minus one credit against the distribution planner.",
  originalDrop: "On the unchanged original interrupted drop with new seeds, lower bounds must exceed zero against Closes and planner, and minus one credit against each of Turns and Drift.",
  reversals: "On equally mixed fresh hot/cold reversals, lower bounds must exceed zero against planner and minus one credit against Closes.",
  archive: "Repeat the hot-drop and reversal criteria on previously released Closes test patterns with new seeds. Full success requires the fresh, original and both archive checks.",
  bootstrapDraws: RESERVE_BOOTSTRAP.draws, bootstrapSeed: RESERVE_BOOTSTRAP.seed,
  uncertainty: "Two-sided paired percentile intervals resample complete scenario seeds within each split. Each draw preserves associated patterns, endings and policies. Results condition on the frozen fit and fixed patterns; secondary intervals are unadjusted.",
});
