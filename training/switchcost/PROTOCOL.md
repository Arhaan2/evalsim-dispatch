# Can the fleet avoid costly switches while keeping profitable ones?

The preceding fleet study added 160 long-repair choices on the short dispatcher's route. Of those, 79 earned more credits through Friday, 30 tied and 51 lost credits. Those 51 motivate this experiment. Exclude the previous evaluation banks from training, calibration, policy selection and testing. Re-evaluate the frozen seed-13 move-recall dispatcher on new freight and repair draws alongside the new release. [Predecessor](https://github.com/Arhaan2/evalsim-dispatch/tree/moverecall-v1.0.0/training/moverecall)

## Which choices can change?

Keep the two repair experts, simulator, prices, historical constant-penalty policy and rolling planner fixed. The experts are named for the repair lengths in their training and can each recommend either waiting or moving. Keep their shared choice when they agree. On a disagreement, retain long actions taken by the first detector (longmove seed 13). For disagreements that detector skips, learn when to veto a move-recall rescue and when a previously skipped long move is worth adding. This gives the new policy a way to recover profitable opportunities when it gives one up. The frozen move-recall policy is the predecessor throughout this document.

For training labels, follow the short expert from Monday opening. On a disagreement skipped by the first detector, try short and long first and follow short on both branches for the rest of the week. The branches use the same ordered trucks, freight realizations and repair updates. Measure long minus short in Friday net credits and signed contracts served. A strict loss has a negative credit difference, a strict win a positive difference. A tie is neither. Make predictions using public freight, truck positions, repair bulletins, previous policies' estimates and public expectations of feasible next-board loads. The true schedule, final repair length, future loads and Friday outcomes are unavailable to the dispatcher.

## Model and policy selection

Train five independent models, with seeds 13, 37, 73, 101 and 211. Designate seed 13 for release before fitting. Each fit gets eleven historical freight families, each contributing 16,384 fit, 4,096 calibration and 8,192 complete selection weeks. The first fit starts at 1,000,000,000 and subsequent fits start one million seeds apart. Within a fit the respective banks start at offsets 0, 250,000 and 500,000, with family index times bank count added. Draw closure starts from [2,4,6] and durations uniformly from [1,2,3,4,4,5,5].

Fit five regularized linear predictors for strict-loss probability, strict-win probability, expected downside, expected upside and service change. Downside is max(0, −credit difference) and upside is max(0, credit difference); both include zeros from other outcomes. Use standardized public inputs, including the precursor forecasts, agreement with the move-recall decision, repair and next-board features and interactions with the preceding decision. Fit targets on the simulated disagreement cases. Use ridge strength 0.10 with an unpenalized intercept. Calibrate on a separate sample with a centered slope constrained to [0,1.5]. Bound probability and credit-magnitude predictions. The training source frozen before fitting specifies the input order, scaling, bounds and tie handling.

The action score in credits is predicted upside − downside + 12 × predicted additional contracts + 6 × predicted win probability − 12 × predicted loss probability. Learn separate cutpoints from the distribution of calibrated scores on preceding rescues and skips. Consider veto fractions [0,0.05,0.15,0.30,0.50] among rescues and added fractions [0,0.05,0.15,0.35,0.60] among skips. Remove low-scoring rescues and take high-scoring skips. Zero disables that intervention. Evaluate all 25 combinations on separate complete selection weeks.

A qualifying rule must capture at least as many fixed-route wins as its predecessor, veto more losing choices than it introduces and earn a positive credit saving on the vetoed set in aggregate. Its actual full-week mean service must reach both the predecessor's and short's; its mean net must exceed its predecessor's, and its paired mean net minus one standard error over short must exceed zero. Select the qualifying rule with the largest reduction in the number of losing selections, then the highest full-week mean earnings advantage over its predecessor, then grid order. If none qualify, use the predecessor. A constant-prediction control uses the same decision settings with calibration target means. Publish all five models and their decisions before scoring any evaluation bank.

## Fresh banks

All ten new freight schedules must be distinct from each other and all preceding fleet patterns under any depot relabeling. Preassign identical incident distributions across schedules. The family index adds 10,000 to the bank's first seed. Monday morning is epoch zero.

| Bank | Freight schedules in bank order | Closure starts | Duration list, sampled uniformly | Weeks per schedule | First seed |
|---|---|---|---|---:|---:|
| Validation | cost-circuit 0011221020, cost-crossing 0112002102 | 1 | 1,2,3,4,4,5,5 | 128 | 1,050,000,000 |
| Fresh | cost-pivot 0001210120, cost-loop 0012021102, cost-turnback 0112200121, cost-ramp 0010112220, cost-rebound 0001122120, cost-weave 0120102210, cost-detour 0012022110, cost-relay 0110021012 | 3,5 | 1,2,3,4,4,4,5,5,5 | 4,096 | 1,060,000,000 |
| Clean | Same eight fresh patterns; all depots open | — | — | 512 | 1,070,000,000 |
| Double-return | Original 0011002200; all depots open | — | — | 4,096 | 1,080,000,000 |

## Nine criteria for the joint claim

1. **Reduce costly switches.** On the fixed short-policy route through the 32,768 fresh weeks, evaluate both policies on every expert disagreement with the same forced-short and forced-long continuations. Compare (predecessor's accepted losses − release's accepted losses) / all disagreements. Require the lower paired two-sided 95% bound to exceed zero. This common denominator prevents a change in the number of accepted moves from redefining success.
2. **Keep profitable recall.** On those same disagreements compare (release's accepted wins − predecessor's accepted wins) / all profitable opportunities. Require the point estimate and lower paired 95% bound to reach at least zero. The noninferiority margin is zero. Report both levels, plus wins forgone and newly recovered.
3. Earn more net credits per fresh week than always following short.
4. Earn more than the historical constant penalty.
5. Earn more than the rolling planner.
6. Match or improve always-short on-time service.
7. Match or improve constant-penalty service.
8. Match or improve planner service.
9. Earn more than the planner on 4,096 new weeks from the original double-return schedule. Check action-by-action agreement with the historical closure-free constant dispatcher and attribute the win accordingly.

For the two recognition tests, jointly resample opportunity-bearing weeks within freight schedule, 2,000 draws with seed 9713. Keep all disagreements within a sampled week together. Give percentile bounds and the number of defined draws for each statistic. A criterion with an undefined bound cannot pass. For the economic tests, run each policy on its own evolving route and resample all paired complete weeks within schedule using 2,000 draws and seed 9713. Earnings require a strictly positive lower 95% bound. On-time service requires a nonnegative mean and lower bound in percentage points. All ten signed contracts per week count, including those disrupted by closure. Each interval quantifies uncertainty across simulated weeks on the registered schedules. Require all nine criteria for the joint claim; report all results regardless of the outcome.

## Trace the gains and costs

On the reference route distinguish the predecessor's added rescues from the original protected long decisions. For vetoed and newly accepted switches, tabulate profitable, tied and losing outcomes, credits saved on losses, profitable credits given up or added, new loss costs and contract effects. Report accepted counts, precision, recall and loss severity. Separately compare actual full-week earnings and service with the predecessor and controls. A fixed-route benefit from vetoing one move can differ from deployed value because later truck positions can change.

Publish splits by freight family and actual repair duration, all five fits, and representative deployment decisions with both Friday ledgers. Arbitrary user agents may choose any legal joint action. Publish the protocol, training and scoring definitions before training and the five checkpoints before evaluation. [Simulator and public agent contract](../../FLEETWEEK.md)
