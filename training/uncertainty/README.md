# When should an overnight fleet agent defer to the planner?

On 4,096 new double-return weeks, the uncertainty policy kept a **1.52-credit weekly advantage** over the rolling planner [+0.79, +2.27]. Across 8,192 weeks on four unseen schedules it earned **0.44 more credits** and served **0.035 percentage points more contracts on time**. Both fresh-week intervals included zero. All brackets below give paired 95% intervals. [Play the decisions](https://arhaan2.github.io/evalsim-dispatch/uncertainty.html#replays) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#uncertainty)

## Three claims fixed before training

The release had to earn more than the planner, match the planner's on-time service with a zero-shortfall margin on the fresh weeks, and earn more than the planner on the original double-return pattern. These intervals come from 2,000 bootstrap resamples of paired full weeks within schedule. They describe the four synthetic schedules and this fixed checkpoint. [Frozen protocol and training code](https://github.com/Arhaan2/evalsim-dispatch/tree/4c2ab7f177beb12760fdc5714a99def62ca554cb/training/uncertainty)

| Primary test | Agent minus planner [95% interval] | Registered criterion |
|---|---|---|
| Fresh weekly net credits | +0.44 [−0.01, +0.91] | Missed |
| Fresh on-time service, percentage points | +0.035 [−0.046, +0.121] | Missed |
| Double-return weekly net credits | +1.52 [+0.79, +2.27] | Met |

The joint criterion was missed. Recovery on the original schedule requires a positive lower bound over the planner. The previous override agent earned +1.78 [+0.93, +2.61] and the original unrestricted fleet agent earned +6.04 [+4.52, +7.50] credits over the same planner on those exact weeks.

| Dispatcher | Fresh net credits/week | Fresh on time | Double-return net credits/week | Double-return on time |
|---|---|---|---|---|
| Uncertainty policy | 334.13 | 73.78% | 336.70 | 73.75% |
| Rolling planner | 333.69 | 73.74% | 335.17 | 73.52% |
| Previous override agent | 334.08 | 73.76% | 336.95 | 73.83% |
| Earlier overnight agent | 333.27 | 73.92% | 336.04 | 73.89% |
| Original fleet agent | 333.62 | 73.43% | 341.21 | 74.14% |
| No downside penalty | 334.09 | 73.77% | 336.87 | 73.81% |
| Constant downside | 334.12 | 73.78% | 336.59 | 73.74% |

## Did estimating downside add value?

All controls dispatch their own complete weeks. The predecessor runs its frozen action rule throughout. The two penalty controls use the release's fitted earnings and service heads, selected settings, candidate source and tie rule. The no-penalty control sets the downside charge to zero. The constant control charges the same 1.73 credits regardless of the board. The released charge varies with the predicted adverse surprise. The table compares the released policy with each control directly.

| Release minus comparator | Fresh net credits/week [95%] | Fresh on-time pp [95%] | Double-return net credits/week [95%] |
|---|---|---|---|
| Previous override agent | +0.05 [−0.20, +0.28] | +0.022 [−0.021, +0.066] | −0.25 [−0.59, +0.10] |
| No downside penalty | +0.04 [−0.16, +0.24] | +0.007 [−0.028, +0.046] | −0.17 [−0.43, +0.09] |
| Constant downside | +0.01 [−0.06, +0.08] | +0.002 [−0.010, +0.016] | +0.11 [+0.002, +0.234] |

On fresh weeks, all three earnings comparisons and all three service comparisons included zero. On the double-return bank the release served 0.061 percentage points fewer contracts than removing its penalty [−0.110, −0.015] and 0.085 points fewer than the previous override agent [−0.146, −0.027]. These are secondary comparisons. The registered double-return goal concerns net earnings over the rolling planner.

Across 32,768 fresh overnight boards, the prior policy proposed an actual override on 1,626 boards along the release's trajectory. The agent accepted 1,246 proposals and kept the planner's move 380 times. Removing the downside penalty would change 266 decisions on these boards. Substituting the constant penalty would change 22. These counts hold the current board fixed. Weekly policy effects come from separate end-to-end rollouts.

| Deployment choice | Helped Friday earnings | Tied | Hurt Friday earnings |
|---|---|---|---|
| Accept | 650 | 11 | 585 |
| Defer | 192 | 4 | 184 |

## Check the downside forecasts

For a proposed move, the fitted mean estimates the difference in net credits through Friday versus the planner. The downside target is the positive part of that mean minus the realized difference, measured under frozen predecessor continuation. A 20-credit forecast means an expected 20 credits of adverse surprise, with favorable or equal outcomes contributing zero. The bracketed intervals in the earnings tables estimate uncertainty about average policy performance across weeks.

The low and middle groups end at 20.70 and 22.62 credits. These are the fitted downside tertiles on the independent calibration examples. The table compares predictions with the corresponding measured target under predecessor continuation on fresh weeks. Its final column separately counts proposals that underperformed with the deployed policy continuing after either action.

| Predicted downside band | Decisions | Accepted | Average prediction | Average observed adverse surprise | Proposals that earned less under deployed continuation |
|---|---|---|---|---|---|
| low | 496 | 325 | 19.00 | 25.43 | 52.0% |
| middle | 580 | 457 | 21.74 | 23.48 | 46.6% |
| high | 550 | 464 | 24.19 | 25.06 | 45.3% |

The upper-risk group had 25.06 credits of observed adverse surprise on average, close to the lowest group's 25.43 and above the middle group's 23.48. The ordering of the forecasts did not carry over to observed downside across the three groups. On these 1,626 decisions, root mean squared error on the adverse-surprise target was 31.86 credits for the conditional predictor and 31.82 for the constant. In the lowest predicted group, the conditional forecast understated average adverse surprise by 6.43 credits.

The study's four worked examples are the median nonzero case in each available accept/defer and helped/hurt group. Both sides of every example keep the signed loads and prefix fixed and use the released policy after the fork.

| Week | Choice | Expected override earnings | Predicted adverse surprise | Penalty (credits) | Actual earnings gain of selected action |
|---|---|---|---|---|---|
| 360000037 | accept | +2.30 | 21.54 | 1.72 | +44 |
| 360000241 | accept | +4.61 | 23.68 | 1.89 | −47 |
| 360000180 | decline | +1.52 | 20.73 | 1.66 | +42 |
| 360030412 | decline | +0.68 | 23.18 | 1.85 | −42 |

## Training the decision

The fixed predecessor is the previous release's fit 13. On Monday through Thursday afternoons, the new policy may only veto a move, wait or redirection that this predecessor would have chosen instead of the rolling planner's action. On all other boards the planner acts. Both actions keep the same signed loads on the same named trucks. The agent observes current orders and positions, realized freight hubs and the bulletin published on Monday. The simulator hides the market name, week seed, demand center and future orders at decision time.

On a training tape, start once from each of six unordered physical truck placements at each overnight board and keep boards where the predecessor actually wants to override. Compare both decisions and use the predecessor's actual labeled-truck rollout thereafter. Backward evaluation of all nine ordered arrival placements preserves its tie rules. Fit separate ridge regressions to the realized earnings and service advantages after subtracting the frozen predecessor's forecasts. The 90 public features include coverage gained or lost, type and cost of the movement, and forecast agreement with recent demand. Earlier and current fleet positions remain separate from future arrivals. [Estimator and gate](../../docs/lib/uncertainty-policy.js) · [Fitter](fit.mjs)

A separate calibration sample produces Friday returns for the same two actions. A 53-input head regresses observed adverse surprises on public board and action features plus the fitted means. Clip the predicted downside at zero. The regressor uses 0.01 ridge per example for all three heads with an unpenalized intercept. Coefficients are stored to eight decimal places. Fitting and audit ran on an Apple silicon CPU using Node 24.18.0 and its standard library.

Selection uses a third set of complete weeks per fit. The candidate score combines a blended net advantage, a blended service advantage times a selected contract value, and a deduction for downside. Positive scores permit the prior override. Exact ties keep the planner. Selection crosses two blend weights, three contract values and three positive downside multipliers. A nineteenth option always defers. Among candidates with paired service mean minus one standard error at least zero, select the largest net gain minus one standard error, with earlier registration winning equal scores. This selects decisions while the simulator keeps its original charges and missed-contract penalties.

The release selected blend 0.5, service credit 0, and downside multiplier 0.08. Its calibration bank had a mean adverse surprise of 21.66 credits. Planner-only fallback was available. Each fit used 8,448 weeks to fit return means, 5,632 separate weeks to learn downside, and 5,632 more to select the whole policy. These eleven training schedules exclude all evaluation schedules, including depot relabelings. The release fit was fixed as 13 before fitting. [Checkpoint and full training-only grid](../../docs/data/uncertainty/model-13.json)

| Fit seed | Mean fit examples | Calibration examples | Downside multiplier | Fresh credits over planner [95%] | Fresh on-time pp [95%] | Double-return credits over planner [95%] |
|---|---|---|---|---|---|---|
| 13 | 12,707 | 8,518 | 0.08 | +0.44 [−0.01, +0.91] | +0.035 [−0.046, +0.121] | +1.52 [+0.79, +2.27] |
| 37 | 12,623 | 8,585 | 0.08 | +0.37 [−0.06, +0.84] | +0.013 [−0.065, +0.098] | +1.59 [+0.83, +2.33] |
| 73 | 12,529 | 8,534 | 0.08 | +0.31 [−0.14, +0.76] | +0.160 [+0.078, +0.242] | +1.02 [+0.30, +1.76] |
| 101 | 12,591 | 8,507 | 0.2 | +0.42 [+0.09, +0.75] | +0.007 [−0.050, +0.070] | +1.26 [+0.67, +1.87] |
| 211 | 12,609 | 8,334 | 0.08 | +0.26 [−0.18, +0.69] | +0.011 [−0.071, +0.090] | +1.58 [+0.90, +2.30] |

## Reproduce the released model

The independent audit advances each paired action from its actual truck destinations through the same future freight. It checks all 63,059 fit returns, all 42,478 calibration targets, the ridge equations for all 15 heads, the two stored downside cutoffs, and 535,040 candidate-selection paths. [Independent training audit](audit-fit.mjs) · [Rebuilt ledger audit](audit.mjs)

```sh
node training/uncertainty/fit.mjs --check
node training/uncertainty/audit-fit.mjs
node training/uncertainty/run.mjs --check
node training/uncertainty/audit.mjs
```

The benchmark accepts JavaScript or Python agents on the same validation, fresh and original double-return weeks. Load your report to replay every action and compare the scored ledgers. [Benchmark your agent](https://arhaan2.github.io/evalsim-dispatch/uncertainty.html#own-agent) · [Download all scored comparisons](../../docs/data/uncertainty/results.json)
