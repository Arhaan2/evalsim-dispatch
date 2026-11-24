import { RESERVE_BOOTSTRAP } from "../../docs/lib/reserve-policy.js";

export const SPEC = Object.freeze({
  method: "Learn a probability model from signed offers and surveys on training shifts, infer which training markets are consistent with the public evidence, and plan bookings for expected net freight credits.",
  trainingSeeds: Object.freeze([13, 37, 73, 101, 211]), releaseSeed: 13,
  blockSize: 12000, margin: 1,
  sampling: "Per fit, sample 6,000 distinct training seeds from its own 12,000-seed block and cross them with all 19 training paths. Both estimators use the same 114,000 tapes. Give cold-ending reversals and hot-ending interrupted drops weight two and the three unpaired original-like cold drop training paths weight three. Give remaining paths weight one.",
  estimator: "Estimate wave-specific high-offer frequencies and survey distributions for each training template, with a 0.5 pseudocount. Update the posterior on the current signed offer and visible surveys. The full policy prices open capacity using future observation branches. Fit a separate finite-horizon control using only current wave, quote and signed offer, price support and free slots.",
  selection: "Fit the full and current-only models on the same tapes for each of five disjoint seed blocks. Publish seed 13 regardless of validation or test scores. Freeze all ten fits before scoring any test, retention or archive trajectory.",
  supervision: "The fitter groups training tapes by training family. Training ending labels annotate the probability of persistence. The decision rule at deployment receives public observations only. The declared training split excludes previously published evaluation schedules.",
  coldReversals: "A win on fresh cold-ending reversals requires a lower paired 95% bound strictly above zero against the frozen distribution-aware planner.",
  hotDrops: "A win on fresh hot-ending interrupted drops requires a lower paired 95% bound strictly above zero against that same planner.",
  originalDrop: "On the original interrupted-drop generator and fresh seeds, the lower bound must exceed zero against the planner and minus one credit against EACH of the published Drift, Turns and Trust agents.",
  joint: "All three primary checks must pass. Report the all-shift result, both other fresh endings, the previous Trust shapes on new seeds, and each seed's results separately.",
  diagnostic: "On all equally weighted hot/cold fresh twins, score the estimated probability of a sustained hot close after each wave's current signed offer and public survey, before booking. Use squared probability error (Brier), accuracy at 0.5 with half credit on ties, and a current-only control. The designated wave-seven comparison requires a positive lower bound for Brier improvement against both a constant 0.5 forecast and the control. A booking win and a detection win are assessed separately.",
  bootstrapDraws: RESERVE_BOOTSTRAP.draws, bootstrapSeed: RESERVE_BOOTSTRAP.seed,
  uncertainty: "Paired percentile intervals resample whole seeds so sibling patterns, endings and policies stay together. Each interval describes the fixed released fit and named scenarios. Additional breakdowns are descriptive.",
});
