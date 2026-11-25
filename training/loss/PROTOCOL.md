# Can a fleet dispatcher recognize a losing override?

## What gets compared

A two-truck fleet serves ten freight boards over five days. At each of four overnight decisions the published Override fit 13 can propose a different empty-truck move from the rolling planner. Both choices book the same signed loads on the same trucks at that board. The new dispatcher may accept the proposal or keep the plan. It sees the public bulletin, realized freight history, current board, truck positions and the two actions. The seed, schedule name, latent demand centers and future offers are unavailable to the policy. Retain the original simulator, costs and deadlines.

Use the original Override model to source proposals and the Uncertainty study's released fit 13 in its published flatRisk mode as the **constant-penalty dispatcher**. These two checkpoints and the original fleet checkpoint are fixed. A second control replaces only the new model's conditional loss probability with its training-calibration prevalence. Report results against each control by name. Each comparator runs all ten boards from its own evolving truck positions on the same exogenous freight tape.

## Training target

At an actual proposed override, make two copies of the simulator. Accept in one and choose the rolling planner's action in the other. From the next board to Friday close use the same published constant-penalty dispatcher in both. The label is one when terminal net credits in the proposal branch are strictly lower. A tie has label zero. Fit a binary loss predictor, a conditional loss-size predictor, a conditional nonloss-return predictor and a signed contract-service predictor. Calibrate the loss probability on separate training schedules' draws. The deployed agent uses these estimated outcomes to value accepting a proposal relative to keeping the plan.

Train five fits in the fixed order 13, 37, 73, 101, 211. Fit 13 is the release, regardless of the other results. Use the eleven schedules used to train the preceding override and uncertainty fits. For fit index i starting at zero, the seed block starts at 400,000,000 + i × 1,000,000. Use 1,024 draws per schedule for training, a separate 512 per schedule starting 200,000 seeds later for calibration, and 768 per schedule starting 400,000 seeds later for policy selection. Freeze feature definitions, fit settings, selection rule and tie handling with the source. Lock all five checkpoints before scoring any of the three release banks. Report all five.

Training enumerates the predecessor’s actual disagreements at the six unordered starting truck placements per overnight board. Its continuation preserves both named trucks at every subsequent board. The held-out diagnostics use only proposals the deployed dispatcher actually encounters. Within each training, calibration and selection block, consecutive families receive contiguous seed ranges.

The fitted heads use ridge least squares with penalty 0.01 on non-intercept coefficients. For the binary targets the squared error is the Brier loss. Include next morning's modeled immediate loss probability and size under the public board distribution as features. Clip raw probability estimates and calibrate in ten equal-width bins with ten midpoint pseudo-observations per bin. Merge adjacent decreasing bins by weighted isotonic regression.

The action value combines (1 − probability) × predicted nonloss gain − probability × predicted loss size with the published constant policy's net-gain estimate. Test learned-return shares of 0.5 and 1, service weights of 0, 15 and 35 credits per additional contract, and earnings hurdles of 0, 2 and 4 credits. Include the planner as the first candidate. On complete policy rollouts across the selection block, admit settings with paired service gain minus one standard error at least zero, over the rolling planner, then maximize paired net gain over the planner minus one standard error. Resolve ties in the frozen grid order.

## Fresh weeks and success criteria

| Bank | Held-out demand-center schedules in manifest order | Draws per schedule | Starting seed |
|---|---|---:|---:|
| Validation | loss-early-relay 0110022210, loss-home-relay 0001221100 | 128 | 450,000,000 |
| Fresh test | loss-return-bridge 0011001220, loss-long-relay 0001112212, loss-market-rebound 0112220010, loss-split-homecoming 0012100110 | 2,048 | 460,000,000 |
| Original double-return | Literal original double-return 0011002200 | 4,096 | 470,000,000 |

Start successive schedules 10,000 seeds apart. Check the six new shapes for overlap against training and previously published schedules, including relabelings of depots. The archive deliberately repeats the historical schedule with independent freight draws. Public test cases will be available to other agents after scoring. Freshness applies to this release.

Use net credits after loaded travel, empty travel and missed-contract penalties. On-time service is the fraction of each week's ten due contracts delivered. Estimate paired differences by resampling entire weeks within schedule, 2,000 replicates, seed 9713. Use the existing two-sided 95% interval convention. Record the following tests for the preselected fit.

1. On the fresh bank, the lower endpoint for net credits per week must be strictly positive against the published constant penalty.
2. On the same weeks, the lower endpoint for net credits must also be strictly positive against the rolling planner.
3. On these weeks, the mean on-time service difference and its lower endpoint must each be at least zero against **both** the planner and constant penalty. The allowed service shortfall is zero percentage points.
4. On new double-return draws, the lower endpoint for net credits over the rolling planner must be strictly positive. The prior win was an advantage over the planner on this schedule.

All conditions must hold for a joint pass. Report individual comparisons, intervals, win/tie/loss counts, schedule-level effects and all fit results even if the joint criterion fails. These intervals describe synthetic week variation conditional on the evaluated policies and schedules.

## Can the predictor recognize losses?

Count actual proposals on the released agent's trajectory, using all four overnight decisions per week as the opportunity denominator. For each proposal, score the model probability against the loss indicator under the same constant-penalty continuation used for training. Report loss prevalence, Brier score versus predicting the training-calibration prevalence everywhere, a tie-aware ROC AUC and counts and observed losses in five fixed probability bands of width 0.2. Report an undefined ROC AUC if only one outcome class is present.

For the separate question of what happened to the deployed fleet, replay the identical action prefix and flip just the overnight decision. Continue with the released policy in both branches through Friday. Record both ledgers. Publish one example per nonempty accept/defer × helped/hurt group closest to that group's median nonzero decision effect. Resolve ties by manifest and decision order. Multiple decisions on one week can interact. Compare full-week paired earnings to measure policy value.
