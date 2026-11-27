# Can the fleet catch profitable moves its previous detector skips?

The last study caught five of 72 profitable alternatives on 16,384 simulated weeks. Its 67 misses motivate this experiment. Exclude that entire bank from fitting, calibration, rule selection and evaluation. Use the frozen seed-13 dispatcher from longmove-v1.0.0 as the predecessor. Test it again alongside the new agent on the same unseen weeks. [Predecessor study](https://github.com/Arhaan2/evalsim-dispatch/tree/longmove-v1.0.0/training/longmove)

## Decision and information

Two trucks serve three depots for ten half-days. The short- and long-repair experts were trained on different repair durations. Either expert can wait or move a truck. Keep the two experts, simulator, planner, historical constant penalty, reward and public observations fixed. On an agreement, use the shared action. On a disagreement, retain every long action selected by the predecessor. Learn when to take long on a board where the predecessor chooses short. A submitted agent can choose any legal joint action.

Train using paired simulator returns through Friday. On an actual short-policy route, force each proposed action at a skipped disagreement and use short thereafter on both branches with identical freight and incident realizations. One example records the strictly profitable label, signed change in net credits, loss magnitude capped below at zero, and change in signed contracts served. A tie has label zero. The deployed model sees the public freight, forecasts, truck positions and repair notices. Realized future demand, realized repair duration and schedule identity are evaluator information.

## Training and rule selection

Use eleven historical freight families, each with 16,384 fit, 4,096 calibration and 8,192 selection weeks per independently trained policy. For fit seeds 13, 37, 73, 101 and 211, assign consecutive million-seed blocks from 900,000,000. Within each block the three bank offsets are 0, 250,000 and 500,000. Add the family index times its bank's per-family count. Draw closure starts from [2,4,6] and durations from [1,2,3,4,4,5,5]. Fix seed 13 for publication before training. Show all five on the same fresh weeks.

Use a case-based model of extra Friday return. Its 58 public inputs are the predecessor's 54 non-intercept features and its probability, expected net, downside and service predictions. Standardize by the fit distribution, clip to four standard deviations either way and quantize in units of 1/32 of a standard deviation. Learn a diagonal distance metric: on eight quantile bins per feature, measure between-bin variation divided by total target variation. Add twice the win-label separation, plus the net, downside and service separations, and a 0.02 floor. On a skipped board use the 64 nearest fit cases. Estimate win rate, signed credit gain, downside and signed service, shrinking each mean toward 16 fit-distribution pseudo-observations. Calibrate each estimate on the disjoint calibration sample with an intercept and centered slope bounded to [0,1.5]. Bound win probabilities to [0.005,0.995] and downside to nonnegative values.

Consider 18 rules, in grid order, combining minimum probability [0.30,0.40,0.50], credit hurdle [−2,0,2], and loss penalty [0,0.10]. A rescue requires meeting the probability minimum and exceeding the hurdle with predicted net + 12 × predicted extra contracts − loss penalty × predicted downside. On complete selection weeks, require (i) mean extra net over always short minus one paired standard error above zero, (ii) mean service at least short's, (iii) mean net at least the predecessor's and (iv) at least one newly caught profitable move on the common short-policy route. Among qualifying settings select the most newly caught strict wins on that route, then the largest one-standard-error earnings bound over short, then grid order. Fall back to the previous dispatcher if none qualify. The constant-prediction control uses calibration target means on previous skips and retains the same inherited switches and selected settings.

## Frozen public banks

The family index adds 10,000 to the starting seed. All ten new schedules are distinct from one another, the training families and the earlier fleet schedules even after permuting depot names. Clean weeks reuse the eight test schedules with different seeds and an open network. Sample incidents independently of freight. Epoch zero is Monday morning.

| Bank | Freight schedules in bank order | Starts | Durations, sampled uniformly from list | Weeks per schedule | First seed |
|---|---|---|---|---:|---:|
| Validation | recovery-transfer 0001212102, recovery-backtrack 0010212210 | 1 | 1,2,3,4,4,5,5 | 128 | 950,000,000 |
| Fresh | recovery-relay 0112102011, recovery-pivot 0001210211, recovery-return 0012201210, recovery-circuit 0010221012, recovery-ramp 0000122102, recovery-weave 0110102212, recovery-diversion 0012220101, recovery-exchange 0122101200 | 3,5 | 1,2,3,4,4,4,5,5,5 | 4,096 | 960,000,000 |
| Clean | Same eight fresh schedules | No incident | — | 512 | 970,000,000 |
| Original double-return | 0011002200 | No incident | — | 4,096 | 980,000,000 |

## Eight release criteria

1. Catch a greater share of profitable long moves than the previous release on the 32,768 fresh weeks. Follow the frozen short expert. At every disagreement compare forced long and short followed by short through Friday. Score both dispatchers on this one list. The paired recall difference equals newly caught wins minus lost hits, divided by all strictly profitable opportunities. Require a positive lower two-sided 95% bound. For this measure, bootstrap 2,000 draws of whole opportunity-bearing weeks within schedule, grouped by week, with seed 9713. Use the same draw for both policies. Report the number of defined draws. Without profitable moves or a defined interval, a win cannot be established.
2. Earn more net credits per fresh week than always short.
3. Earn more than the constant penalty.
4. Earn more than the rolling planner.
5. Match or improve always-short on-time service on fresh weeks.
6. Match or improve constant-penalty service.
7. Match or improve planner service.
8. Retain the net-credit win over the planner on 4,096 fresh draws of the original closure-free double-return schedule. Check every move against the historical constant dispatcher to identify any inherited win.

For economic criteria, run each policy on its own trajectory over identical weeks. Net deducts travel and missed-contract penalties. All ten signed deadlines count for service, including those affected by closure. Stratify paired whole-week bootstrap samples by schedule, using 2,000 draws and seed 9713. Earnings wins require the lower two-sided 95% bound above zero. Service requires both the point estimate and lower bound at least zero percentage points. These are individual intervals. The joint claim requires all eight gates for the predesignated release fit. Report every result either way. The intervals describe variation across freight and incident draws on these schedules.

## Interpret the deployment

Report fixed-route wins, ties and losses selected by each policy, precision, recall and both recall levels on the common denominator. Show changes in decisions, counts and signed credit outcomes by added or dropped move. Distinguish those fixed-route counterfactuals from the realized full-week earnings difference between the policies. Also report calibration and ranking diagnostics, by-family and repair-duration breakdowns, seed sensitivity, performance against always long and constant predictions, and actual-path examples replayed with the release as the continuation on both branches. Show what happens on books with no closures separately. Publish the protocol and runnable research definitions before training and lock all model checkpoints publicly before running the evaluation. The 67 historical misses specify the question and contribute no cases to the new result.
