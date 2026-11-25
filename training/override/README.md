# When should the fleet override an overnight move?

On 2,048 new weeks of the original double-return schedule, the trained dispatcher earned **2.32 more net credits per week** than the rolling planner and served **0.420 percentage points more contracts**. On 4,096 weeks from four unseen schedules, its advantage shrank to **0.43 credits** and **0.056 percentage points**. Both fresh-week intervals included zero. The agent recovered the double-return win. The fresh earnings and zero-shortfall service goals remain open. [Play the study](https://arhaan2.github.io/evalsim-dispatch/override.html) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html)

## Fresh weeks and double returns

All dispatchers start each week with the same trucks and receive the same freight, public bulletin, travel costs and missed-contract penalties. Each owes ten on-time deliveries. The intervals below resample complete paired weeks within each schedule, using 2,000 bootstrap replicates. Their uncertainty describes repeats of these synthetic schedules for a fixed policy.

| Evaluation | Dispatcher | Net credits/week | On time | Net difference from planner [95%] | On-time difference in percentage points [95%] |
|---|---|---:|---:|---:|---:|
| 4,096 fresh weeks | Rolling planner | 329.77 | 72.65% | Reference | Reference |
| | Trained override policy | 330.20 | 72.70% | +0.43 [−0.28, +1.16] | +0.056 [−0.078, +0.190] |
| | Preceding overnight RL | 329.03 | 72.77% | −0.74 [−1.44, −0.02] | +0.125 [−0.012, +0.261] |
| | Original fleet RL | 326.74 | 71.91% | −3.03 [−4.49, −1.55] | −0.737 [−1.021, −0.447] |
| | Always accept the proposed override | 296.88 | 68.88% | −32.89 [−35.38, −30.40] | −3.765 [−4.175, −3.359] |
| | Greedy dispatcher | 274.31 | 57.76% | −55.46 [−58.43, −52.50] | −14.890 [−15.344, −14.409] |
| 2,048 double-return weeks | Rolling planner | 334.68 | 73.68% | Reference | Reference |
| | Trained override policy | 337.00 | 74.10% | +2.32 [+1.13, +3.52] | +0.420 [+0.205, +0.630] |
| | Preceding overnight RL | 336.14 | 74.13% | +1.46 [+0.23, +2.62] | +0.449 [+0.234, +0.654] |
| | Original fleet RL | 339.76 | 74.11% | +5.07 [+3.03, +7.02] | +0.430 [+0.073, +0.791] |
| | Always accept the proposed override | 320.38 | 72.82% | −14.30 [−17.59, −10.96] | −0.859 [−1.465, −0.293] |
| | Greedy dispatcher | 272.60 | 57.64% | −62.09 [−66.45, −57.76] | −16.040 [−16.748, −15.327] |

The trained policy earned more than the planner in 390 fresh weeks, tied in 3,328 and earned less in 378. It out-earned the preceding overnight policy by 1.17 credits [+0.43, +1.90] on these weeks. On the archive it trailed the original fleet policy by 2.75 credits [−4.55, −0.96]. Recovery required a positive lower bound against the planner. It did not require matching the original agent's margin. [Paired comparisons and all split results](../../docs/data/override/results.json)

| Unseen schedule, 1,024 weeks each | Net credits over planner [95%] | On-time difference in percentage points [95%] |
|---|---:|---:|
| Staggered return | −0.36 [−1.94, +1.13] | +0.049 [−0.244, +0.342] |
| Second return | +0.80 [−0.46, +2.01] | +0.107 [−0.107, +0.322] |
| Friday detour | +1.07 [−0.51, +2.80] | +0.215 [−0.078, +0.518] |
| Relay backtrack | +0.21 [−1.20, +1.59] | −0.146 [−0.381, +0.088] |

Fit 13 was designated for release before training. Every fit cleared the double-return earnings criterion. Each fit's fresh earnings and fresh service intervals included zero. The five fits share the same evaluation weeks. [Frozen protocol, seeds and schedule definitions](https://github.com/Arhaan2/evalsim-dispatch/tree/a3bbe0f901dfbd1e1f1597dc86fdc5b3000f6769/training/override)

| Fit seed | Fresh earnings over planner [95%] | Fresh on-time gain in percentage points [95%] | Double-return earnings over planner [95%] |
|---|---:|---:|---:|
| 13 | +0.43 [−0.28, +1.16] | +0.056 [−0.078, +0.190] | +2.32 [+1.13, +3.52] |
| 37 | +0.29 [−0.24, +0.84] | +0.051 [−0.051, +0.154] | +1.88 [+0.90, +2.88] |
| 73 | +0.35 [−0.35, +1.07] | +0.027 [−0.105, +0.159] | +2.59 [+1.34, +3.79] |
| 101 | +0.29 [−0.15, +0.74] | +0.034 [−0.049, +0.142] | +1.16 [+0.35, +1.98] |
| 211 | +0.51 [−0.19, +1.23] | +0.081 [−0.056, +0.210] | +2.41 [+1.21, +3.64] |

## What the dispatcher learned to decline

On 8,647 eligible fresh nights, the dispatcher accepted 851 overrides and declined 7,796. Following its own decisions after the fork, 426 accepted overrides earned more through Friday than keeping the planner's choice, 418 earned less and seven tied. Declining an override earned more on 4,910 nights, less on 2,801 and the same on 85. Forks can occur repeatedly in one week. The full-week comparison with accepting every proposal was **+33.32 net credits** [+30.97, +35.70] and **+3.821 percentage points** of service [+3.438, +4.221].

| Fresh week | Decision with the same booked freight | Predicted net advantage of the proposal | Actual net gain of the chosen action through Friday |
|---|---|---:|---:|
| Thursday, 260000252 | Accept moving the empty truck from Junction to Inland for 16 credits | +7.87 | +44, one extra contract |
| Monday, 260000008 | Accept waiting at Harbor and cancel the planner's 19-credit move to Junction | +3.55 | −39, one fewer contract |
| Monday, 260000001 | Decline waiting and keep the planner's 12-credit trip from Inland to Harbor | −9.24 | +51, one extra contract |
| Tuesday, 260000010 | Decline a 19-credit trip from Junction to Harbor and stay at Junction | −7.77 | −35, same service |

The predicted column always values the proposed override relative to keeping the planner. The actual column values the selected action relative to the other branch. Each example is the nearest to the median within its accept/decline and help/hurt group. The public desk reveals the two complete Friday ledgers after a visitor makes a choice. [Compare both branches](https://arhaan2.github.io/evalsim-dispatch/override.html#replays)

## How a planner becomes an overnight RL dispatcher

The planner chooses loads for each truck. On Monday through Thursday afternoons, the learned policy examines the other legal empty moves and waits that preserve those exact assignments. Alternatives that reach the same pair of depots retain the best immediate net. The release compares the strongest remaining proposal with the planner. Mornings and Friday's close follow the planner. The original unrestricted fleet agent can also change the freight assignments and morning decisions. [Planner](../../docs/lib/fleetweek-planner.js) · [Override policy](../../docs/lib/override-policy.js)

For training, freight arrives independently of truck moves. This permits a same-week counterfactual. From each of six possible physical starting placements on each overnight board, send the idle truck according to either the planner or one eligible challenger. Follow the rolling planner after each action through Friday. The difference in total net credits measures the earnings advantage. The difference in served contracts measures the service advantage. Backward evaluation uses all nine ordered arrival placements so truck-specific tie-breaking survives. The released policy can override again at later boards, which the end-to-end selection and evaluation rollouts explicitly exercise.

Two ridge regressions share 55 public, action-relative features. The earnings model estimates a correction to the planner's advantage, which already includes the trip charge. The service model estimates the change in fulfilled contracts. Features include which depots gain or lose coverage, the cost of moving, recent observed hubs and agreement with Monday's ten-interval bulletin. A second estimate of demand uses a duration model for the latent center and integrates it through the same public board distribution used by the planner. It models the simulator's published lead/lag and realization probabilities. Its four fixed change probabilities of 0.16, 0.38, 0.44 and 0.36 depend on how long the latent center has held. The release marginalizes over possible centers using observed history and the entire bulletin available on Monday. The fit learns from realized returns. The benchmark measures this combination of a hand-specified demand model and learned corrections. It has no separate ablation of the demand model. No inference input identifies a week, a schedule, the actual latent center or an unsigned future load. [Training implementation](fit.mjs) · [Simulator](../../docs/lib/fleetweek.js)

The published fit ran on an Apple silicon CPU with Node 24.18.0 and its standard library. Each fit used 8,448 weeks and a separate 4,224-week selection sample from eleven training schedules. The original double-return schedule and all held-out schedules stayed out of both samples. The regressor applies a 0.002 ridge penalty per example, exempts the intercept and stores coefficients to eight decimal places. Selection crossed two correction weights, three values for a future served contract and three minimum earnings-equivalent hurdles. A nineteenth candidate always kept the planner's choice. Among configurations whose service gain minus one standard error was nonnegative, selection maximized net gain minus one standard error. Exact ties retained the earlier registered candidate. The release's selected weight was 1, service value 0 and hurdle 0. On its selection weeks it overrode 719 times for +0.67 credits per week and +0.099 percentage points of on-time service. Its realized ledger always uses the simulator's original costs and revenue. [Release checkpoint and selection grid](../../docs/data/override/model-13.json)

## Reproduce and benchmark

From the tagged repository with Node 22 or later, the following checks refit all five models, independently validate the learned values, reproduce scored policies on fresh weeks, and rebuild the signed-load ledgers and alternative Friday outcomes.

```sh
node training/override/fit.mjs --check
node training/override/audit-fit.mjs
node training/override/run.mjs --check
node training/override/audit.mjs
```

The independent training audit executed paired branches forward from their actual ordered truck placements for all **1,758,761** training examples, checked both regressions at each of five seeds, and replayed **401,280** complete candidate-policy selection weeks. The largest normalized ridge-equation residual was below 1.5 × 10⁻⁸. An additional test enumerates all 59,049 possible ten-period demand-center paths on one public board to check the probability calculation. [Independent fit audit](audit-fit.mjs) · [Policy tests](../../test/override-policy.test.mjs)

A visiting JavaScript or Python policy can choose any legal joint action on all ten half-days. Run it on the validation, fresh or archive weeks, then load its JSON report into the study to verify the decisions and inspect any Friday ledger. [Benchmark your dispatcher](https://arhaan2.github.io/evalsim-dispatch/override.html#own-agent) · [CLI and report guide](../../OVERRIDE.md)
