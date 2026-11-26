# Learning when to reposition during a depot closure

Two trucks serve three depots over ten half-days. A public repair notice arrives one board before a depot closes. Depending on repair progress, the dispatcher can receive a noisy field update. The trained policy can change the incumbent dispatcher's empty moves during the warning or closure. It keeps the same signed loads on the same trucks. Each comparison includes loaded travel, empty travel and a 34-credit penalty for every missed deadline. [Play the closure challenge](https://arhaan2.github.io/evalsim-dispatch/closure.html) · [Benchmark your agent](../../CLOSURE.md)

On 8,192 new closure weeks, the constant-penalty dispatcher earned **0.344 more net credits per week** than the frozen release (agent minus constant paired 95% interval −0.628 to −0.055). The release served 0.084 percentage points more contracts on time than the rolling planner. Two of five preregistered tests passed. [Measured results and replays](https://arhaan2.github.io/evalsim-dispatch/closure.html#results) · [Five checkpoints locked before evaluation](https://github.com/Arhaan2/evalsim-dispatch/tree/e523aa78af04d7508551dd00150fd6770c564bea/docs/data/closure)

## Monte Carlo policy improvement

The incumbent is the published constant-penalty dispatcher with its frozen uncertainty and override checkpoints. Its rolling planner and proposal generator use the common closure restrictions and public repair forecast. During an incident, the new agent scores each distinct reachable pair of ending depots. Across alternatives with the same freight assignments and ending depots it keeps the move with the highest immediate net credits. When a closure has yet to be announced, after reopening, and at Friday close, the release takes the constant policy's action. On an ordinary week every action is therefore inherited. The no-incident archive measures whether that inherited policy still leads the rolling planner.

Training uses matched simulated freight and repair paths. For every warning or closed board before Friday's last decision, the fitter places the trucks at each of the nine ordered starting positions for the **next** board. From there the constant-penalty policy serves the remaining boards through Friday. The fitter accumulates the exact net credits and number of fulfilled contracts. For each of six physical pairs of depots, it averages the two truck orderings and subtracts the mean across all six pairs. The two target values therefore describe what a different placement is worth on the same tape. This procedure uses the simulator's realized future only to construct training targets. Legal actions and fitted inputs use public observations.

Two ridge-regression heads predict differences in future net credits and on-time contracts. The earnings head corrects the closure-aware planner's expected value of ending at each depot pair. The service head corrects the probability that the trucks could reach the next due contract, given the public forecast and repair uncertainty. Both use the same 58 inputs, including an intercept, relative depot coverage, current and forecast freight hubs, the repair bulletin, and expected closure duration expressed through next-board closure probabilities. The ridge penalty is 0.01 per training example on each non-intercept coefficient. The calibration bank estimates a least-squares scale for each head's corrections, clipped to [0, 1.5]. Costs and rewards are measured in original simulator credits across all policies. [Policy code](../../docs/lib/closure-policy.js) · [Training code](fit.mjs)

The deployed dispatcher evaluates an empty move by adding its immediate net credits to the change in expected Friday earnings, then adding its predicted change in service times a learned choice of service weight. It takes the best alternative only when this score strictly exceeds the chosen switching hurdle. Selection compares earnings blends of 0.5 and 1, service weights of 0, 12 and 30 credits per additional contract, and hurdles of 0, 2 and 5 credits. A nineteenth candidate retains the constant policy on every board. Each candidate drives a complete fleet from Monday to Friday on each selection week. Among policies whose paired mean service difference minus one standard error is nonnegative against both baselines, selection maximizes the smaller of the two earnings differences minus one standard error. Ties take the earlier candidate. If none qualifies, selection takes the incumbent.

## Training and verification

Each of five runs uses 4,224 training weeks, 1,408 separate calibration weeks and 4,224 selection weeks. Every bank includes the same eleven training freight families. Training closures start in half-days 2, 4 or 6 (Monday morning is zero), and last one to three half-days. The release uses seed 13, designated before fitting. Seeds 37, 73, 101 and 211 measure training variation. For fit index i in that order, the first seed is 500,000,000 + 1,000,000 × i. Calibration and selection banks start 200,000 and 400,000 later. [Protocol fixed before training](https://github.com/Arhaan2/evalsim-dispatch/tree/64806116adf4486d719db55c4be918f6767d3157/training/closure)

```sh
node training/closure/fit.mjs --check
node training/closure/audit-fit.mjs
```

The first command refits each model and compares its exact output bytes with the recorded checkpoint. The second constructs the target returns again by forward dispatch from each alternative placement, checks the ridge first-order equations, recalibrates both correction scales and reproduces every whole-week selection result.

| Fit | Training placement labels | Calibration labels | Net correction scale | Service correction scale | Credits per contract | Hurdle | Selection overrides |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 13 | 76,440 | 25,764 | 0.977 | 0.882 | 30 | 5 | 322 |
| 37 | 75,318 | 25,266 | 0.926 | 1.004 | 12 | 0 | 690 |
| 73 | 75,768 | 25,266 | 0.890 | 0.909 | 30 | 0 | 795 |
| 101 | 76,026 | 25,458 | 1.010 | 0.998 | 30 | 5 | 345 |
| 211 | 76,326 | 25,506 | 1.070 | 1.072 | 12 | 2 | 495 |

## Performance on new schedules and new closure timings

The four fresh evaluation families each supply 2,048 weeks. Their closures start on Tuesday or Wednesday afternoon (half-days 3 and 5). Each family uses a different duration mixture that includes repairs longer than the training maximum. All policies dispatch the same exogenous freight and repair tape. The following paired differences use whole-week resampling within freight families, with 2,000 draws.

| Registered test | Release difference [paired 95% interval] | Result |
|---|---:|---|
| Fresh net vs rolling planner | −0.272 [−0.745, +0.201] credits/week | Inconclusive |
| Fresh net vs constant penalty | −0.344 [−0.628, −0.055] credits/week | Favored constant |
| Fresh on time vs rolling planner | +0.084 [+0.011, +0.156] percentage points | Met |
| Fresh on time vs constant penalty | +0.039 [−0.004, +0.084] percentage points | Inconclusive |
| No-incident double-return net vs rolling planner | +1.396 [+0.610, +2.192] credits/week | Met |

The release chose a different move from the constant penalty on 808 of 23,459 eligible boards along its own path. Across entire weeks, the two policies' action sequences differed in 687 cases. Net earnings were higher for the release on 270 weeks, tied on 7,601 and lower on 321. Every one of the five fixed fits had a negative fresh earnings interval relative to the constant penalty. The two policies made identical decisions on all 2,048 no-incident fresh weeks and all 4,096 original double-return weeks. The archive gain is inherited from the constant-penalty policy.

A post-evaluation breakdown groups the 8,192 weeks by the number of half-days the depot was actually closed through Friday. Each difference below compares the released policy with the constant penalty on the same weeks. These groups have different mixes of freight schedules. The table describes where the earnings deficit occurred and cannot isolate the effect of repair length.

| Closed half-days | Fresh weeks | Net credits/week over constant | Service change (percentage points) |
|---:|---:|---:|---:|
| 1 | 1,354 | +0.423 | +0.052 |
| 2 | 2,053 | +0.266 | +0.093 |
| 3 | 658 | +0.286 | +0.091 |
| 4 | 2,032 | −0.348 | +0.049 |
| 5 | 2,095 | −1.633 | −0.048 |

[Week-by-week ledgers](../../docs/data/closure/test.json) · [Paired score tables for all fits](../../docs/data/closure/results.json) · [Original registered criteria](PROTOCOL.md)
