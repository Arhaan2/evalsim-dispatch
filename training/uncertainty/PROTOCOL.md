# When should the fleet stay with the planner?

## Decision and success criteria

Use the five-day DISPATCH fleet with two named trucks and three depots. The preceding published override policy (fixed seed 13) supplies the possible intervention. On a Monday–Thursday afternoon when that policy would actually change the rolling planner's move, the new policy chooses between the two exact joint actions. It may veto a trip, a cancellation or a redirection. Signed freight stays on the same truck on that board. The preceding policy's abstentions, daytime assignments and Friday close follow the planner. The new policy can affect later truck locations and the freight reachable from them. The simulator, public observation, net ledger and ten hard-due contracts per week are the same for each dispatcher.

Designate fit 13 as the release and keep fits 37, 73, 101 and 211 for reporting training variation. Lock each fit and its settings before opening any evaluation bank. Evaluate three claims for the release:

1. On four unseen schedules, require a strictly positive lower bound for average weekly net credits over the planner.
2. On those same weeks, require the observed on-time rate to be at least the planner's rate and the lower bound of their difference to be at least zero percentage points. The service margin is zero.
3. On fresh draws from the original double-return schedule, require a strictly positive lower bound for the net earnings difference over the planner. Report the preceding override policy and original unrestricted fleet agent on these same tapes to show the magnitude of the earlier wins.

Use two-sided 95% paired intervals, 2,000 bootstrap resamples of complete weeks within each schedule, with seed 9713 as in the prior release. The joint goal requires all three criteria. Report all verdicts, including a planner-only outcome or uncertain difference. The uncertainty in these estimates describes week-to-week variation on these synthetic schedules, conditional on the chosen fit.

## Learn and calibrate without opening the test

Use the same eleven training schedules as the preceding override release. None is the original double-return pattern or a held-out validation/fresh pattern, including depot-label permutations. For fit index i in the fixed seed order above, begin at 300,000,000 + 1,000,000 × i. Fit on 768 weeks per family (8,448), calibrate on a disjoint block beginning 200,000 later with 512 per family (5,632), and use a third block beginning 400,000 later with 512 per family (5,632) for complete-policy selection. Generate samples within each block in family order. The public implementation fixes the feature definitions, exact label construction, settings and tie rules.

Train from the paired through-Friday returns after the predecessor's actual override and the planner's move. In both training continuations, follow the fixed predecessor from the following board. The public predictor sees today's board, the bulletin available on Monday, observed freight history and the two candidate moves. Neither seed, family, actual latent center nor future arrivals is available at decision time. Learn a conditional mean net advantage and a contract-service advantage. On separate calibration weeks learn the expected shortfall of an individual override's outcome below its predicted mean net advantage: max(0, predicted mean minus realized proposal-minus-plan credits). An outcome can fall short of its predicted mean and still beat the planner. This predictive downside is measured in credits and is distinct from a confidence interval or a probability of loss.

The release discounts expected advantage by a multiple of conditional downside when deciding whether to override. Selection crosses mean correction blends of 0.5 and 1, service weights of 0, 15 and 35 and downside weights of 0.08, 0.20 and 0.40, plus a planner-only fallback. Among settings whose paired service gain minus one standard error is at least zero on selection weeks, maximize paired net gain minus one standard error. Tie rules and predictor details are fixed in the accompanying code. The evaluation ledger always uses the original revenue and costs.

## Held-out weeks and controls

| Split | Patterns in manifest order | Weeks and block start |
|---|---|---|
| Validation | short-week-loop 0012222001, midweek-relay 0001122111 | 128 per schedule, starting at 350,000,000 |
| Fresh test | switchback-home 0011000220, late-double-loop 0001002110, closing-relay 0011222012, midweek-feint 0001011222 | 2,048 each, starting at 360,000,000 |
| Original double-return | double-return 0011002200 | 4,096 from 370,000,000 |

Successive schedules in each split start 10,000 seeds apart. The fresh test has 8,192 common weeks. External agents can access all legal fleet actions on the same weeks through the existing JavaScript or Python interface, with a one-second decision budget. Public test seeds support independent reproduction and are held out of this release's training and selection.

Compare the release with the planner, previous override fit 13, previous overnight fit 13 and original fleet fit 13. Compare two ablations with the release's other settings held fixed: meanOnly removes the downside penalty; flatRisk replaces conditional downside with the calibration-wide mean adverse surprise. Report paired earnings and service differences so that a win against the planner can be distinguished from an improvement specifically due to estimating uncertainty. All controls run on their own trajectories on identical freight.

## Where did deferral help?

Trace the release and count all four overnight boards per week. Record how often the predecessor actually recommends a change on the board it sees, how often the release accepts or defers, and which decisions differ when removing or flattening its risk penalty. For each actual recommendation, fork from the exact prefix to the prior proposed move and to the planner. Use the same released policy on each suffix, then record credits and service through Friday. Do not count every idle-truck opportunity as a recommendation. Repeated forks from the same week are descriptive and cannot be summed as an end-to-end policy effect.

Report low, middle and high predicted-downside groups using cutoffs fixed from calibration. Show group counts, mean predicted downside, and empirical adverse surprise measured under the same predecessor continuation used to fit the risk target. Separately report how often the proposal earned less than the planner's move under the deployed continuation. Report actual accept/defer × helped/hurt examples closest to each group's median nonzero realized difference in net credits. Break ties by manifest order and then decision round. Omit an empty group. On the public desk show what the policy knew at decision time before revealing either Friday ledger.
