# Learning the value of an empty overnight move

At the Monday, Tuesday, Wednesday and Thursday afternoon dispatches, the new policy asks whether moving an idle truck changes the rest of the week. The rolling planner supplies the current load assignments. The trained policy can keep an empty truck in place, send it to either other depot or redirect an empty trip. Each truck keeps any signed job assigned to it for the current round. The planner handles mornings and Friday afternoon. This makes the released policy a hybrid of planning and fitted reinforcement learning.

## Results on fresh weeks

On 2,048 weeks from four previously unseen schedules, the trained hybrid earned **338.09 net credits per week** and served **74.73%** of contracts on time. The rolling planner earned **338.36** and served **74.63%**. The earnings difference was −0.27 credits (paired 95% interval −1.16 to +0.56). The observed on-time difference was +0.093 percentage points (−0.059 to +0.249). Both intervals included zero, so the agent missed the registered earnings and zero-shortfall service criteria. It earned more than the planner on 158 weeks, tied on 1,717 and earned less on 173. [Study](https://arhaan2.github.io/evalsim-dispatch/overnight.html) · [Pre-training freeze](https://github.com/Arhaan2/evalsim-dispatch/tree/aa97786f844b3b08c44be46387f2bd14c3ce7932/training/overnight)

| Fresh dispatcher | Mean net credits | On time | Empty miles / week |
|---|---:|---:|---:|
| Overnight hybrid, fit 13 | 338.09 | 74.73% | 54.48 |
| Rolling planner | 338.36 | 74.63% | 53.46 |
| Previous fleet RL, fit 13 | 337.16 | 74.00% | 53.01 |
| Same hybrid, always waits overnight | 321.58 | 70.11% | 32.13 |
| Greedy dispatcher | 276.34 | 57.68% | 0.00 |

Against its own always-wait control, the hybrid earned **+16.51 credits** [+14.20, +18.81] and gained **+4.614 percentage points** [+4.233, +4.995] of service. The control permits empty travel during the day. Against the previous fleet RL policy, the new hybrid earned +0.94 credits [−1.01, +2.92] and served +0.728 percentage points [+0.342, +1.089] more contracts. On the 256-week validation bank it earned +4.64 credits over the planner [+1.62, +7.84]. All five checkpoints had already been fit and selected before validation was scored. [All scored comparisons](../../docs/data/overnight/results.json)

| Fresh schedule, 512 weeks each | Net credits over planner [95% interval] | On-time difference in pp [95% interval] |
|---|---:|---:|
| early-double-return | +1.51 [−0.30, +3.41] | +0.273 [−0.039, +0.625] |
| late-double-return | −0.42 [−2.11, +1.24] | −0.059 [−0.332, +0.215] |
| overnight-relay | −2.69 [−4.40, −0.94] | −0.117 [−0.410, +0.195] |
| late-homecoming | +0.54 [−1.48, +2.52] | +0.273 [−0.059, +0.625] |

## Original double-return check

On 1,024 new draws from the original double-return schedule, the previous fleet RL policy again beat the planner by **4.81 credits per week** [+1.86, +7.54]. The overnight hybrid averaged 333.60 against the planner’s 333.23, a difference of +0.37 [−1.07, +1.92]. Its on-time difference favored the hybrid by +0.430 percentage points [+0.166, +0.713]. The hybrid missed the earnings-retention criterion and trailed the previous fleet RL policy by 4.43 credits [−7.10, −1.66]. The joint fresh earnings, service and double-return objective was missed. [Archive trajectories](../../docs/data/overnight/archive.json)

## What an individual empty move changed

There were 4,157 fresh overnight boards with an idle truck after the planner assigned the signed loads. The learned policy repositioned on 2,069 and waited on 2,088. We forked at each board, changed only the current empty move or wait, then ran the same learned policy through Friday on the same freight. Compared with waiting, 1,333 of the selected moves earned more, 718 earned less and 18 tied. Compared with the planner’s preferred feasible forced move, 1,336 of the selected waits earned more, 726 earned less and 26 tied.

On 358 of those boards the trained policy actually changed the planner’s on-the-spot choice. It initiated an empty departure 171 times, canceled one 94 times and redirected a departure 93 times. The learned choice earned more on 171 of the 358 forks, earned less on 185 and tied on two. Multiple forks can come from one week. Full-week policy differences above come from separate end-to-end runs. [Replay the four representative choices](https://arhaan2.github.io/evalsim-dispatch/overnight.html#replays)

| Trained choice on a fresh tape | Immediate difference | Next morning’s net difference | Difference at Friday close |
|---|---:|---:|---:|
| Thursday, 160000068. Move the spare from Junction to Inland. Friday’s Inland contract is now reachable. | −16 | +60 | +44 credits, +1 contract |
| Tuesday, 160000218. Move Harbor to Junction. Staying at Harbor would earn more on Wednesday’s spot load. | −19 | −12 | −31 credits, same service |
| Wednesday, 160000312. Keep the spare at Inland. It serves Thursday’s contract there. | +12 | +48 | +60 credits, +1 contract |
| Thursday, 160000004. Wait at Harbor. Moving to Junction would serve Friday’s contract. | +19 | −58 | −39 credits, −1 contract |

These examples are the cases nearest the median nonzero payoff in each helped/hurt group for moves and waits. Ties use manifest order and then round.

## Training variability and verification

| Fit seed | Fresh net credits | Net difference over planner [95% interval] | On-time difference in pp [95% interval] |
|---|---:|---:|---:|
| 13 · release | 338.09 | −0.27 [−1.16, +0.56] | +0.093 [−0.059, +0.249] |
| 37 | 338.21 | −0.15 [−1.12, +0.78] | +0.210 [+0.039, +0.371] |
| 73 | 338.18 | −0.18 [−1.06, +0.72] | +0.137 [−0.010, +0.283] |
| 101 | 338.02 | −0.34 [−1.29, +0.65] | −0.171 [−0.327, −0.005] |
| 211 | 338.20 | −0.16 [−0.84, +0.54] | +0.068 [−0.054, +0.186] |

Each fit trained on a separate 5,376-week bank. The five rows share the same test weeks. Every fit’s fresh mean net earnings fell below the planner. Only seed 37 cleared the zero-margin service criterion. Fit 13 selected a correction blend of 0.45, a service weight of 10 and a minimum gain of zero. On its own training-selection bank it changed 416 overnight planner choices and earned +0.70 credits per week over the planner.

An independent training check reconstructed 645,120 same-tape placement returns across the five fits, checked all 240 regressions against their ridge normal equations (largest absolute residual after dividing by sample size, 2.29 × 10⁻⁸), and replayed all 161,280 candidate-policy selection paths. Published week-level intervals resample paired whole weeks within each schedule. [Benchmark guide](../../OVERNIGHT.md) · [Reproduction script](./run.mjs) · [Independent ledger checks](./audit.mjs)

## Paired Monte Carlo policy improvement

To check every stored fit and training-only policy selection independently, run `node training/overnight/audit-fit.mjs` from the repository root. [Independent fit audit](audit-fit.mjs)

Each training week supplies ten signed freight boards. For each of the four overnight decisions, replay the remaining half-days from all six feasible pairs of truck locations. Both trucks then follow the rolling planner through Friday on the same realized arrivals. A backward pass evaluates all six starting placements exactly for that training tape. Net reward includes loaded and empty travel and missed-contract penalties. A second return counts fulfilled contracts. These are returns from the planner’s future decisions. A separate rollout measures the deployed hybrid making its own later overnight choices.

For each night, fit two six-output ridge regressions. The net head predicts the difference between the simulated net return and the planner’s continuation estimate. The service head predicts the remaining number of contracts fulfilled. Center the six labels in each training example so changes in overall market revenue or demand cannot change an action ranking on their own. The fit uses unit discount, an unpenalized intercept, a ridge penalty of 0.002 per observation, and eight-decimal checkpoint coefficients. The simulator’s arrivals are independent of the trucks’ choices, so all six starting locations share an observed continuation tape. The learner receives no reference action labels to imitate.

The 101 features use current and previous hub observations, the bulletin published Monday, patterns in which depots lead adjacent forecast periods, and two public planning estimates. The first estimate uses the published forecast. The second gives the forecast’s leading depot a fixed probability of 0.72 and assigns 0.14 to each other depot. Their contrast helps the learned estimator adjust the effect of reported confidence on placement. The trained heads do not receive a week seed, schedule name, hidden demand center or future signed load. [Learner](fit.mjs) · [Inference policy](../../docs/lib/overnight-policy.js)

At decision time each allowed joint move is scored by its immediate net credits, the planner's continuation value, the scaled learned correction, and a service weight times predicted future contracts. An alternative must exceed the planner's score by the selected minimum gain. A tie retains the planner’s move. The service weight and minimum gain affect which dispatch decision is taken; published earnings always use the original unmodified ledger.

## Training and selection

The release seed is 13. Seeds 37, 73, 101 and 211 estimate training variability on the same evaluation manifests. For fit index 0 through 4, training starts at 100,000,000 plus 1,000,000 times the index. Each of seven training schedules contributes 768 complete weeks. This yields 5,376 weeks, 21,504 overnight boards and 129,024 placement-return pairs per fit. Each pair has both a net and a service target.

A distinct selection set starts 200,000 seeds after that fit’s training start. It contains 384 weeks from each of the same seven training schedules, for 2,688 weeks per fit. The 12 configurations cross correction blends of 0.45 and 0.9, service weights of 0, 10 and 30 credits per additional predicted contract, and minimum gains of 0 or 1.5 credits. Each candidate and the planner run complete weeks on identical arrivals. The checkpoint records all candidate comparisons. Select the largest paired mean earnings gain minus one standard error among configurations whose paired service gain minus one standard error is nonnegative. If none qualify, select the largest service lower bound, breaking ties by the earnings lower bound. Final ties use candidate enumeration order. These training-only standard errors are used for selection. The study protocol specifies the separate uncertainty procedure for published test results. [Protocol](PROTOCOL.md)
