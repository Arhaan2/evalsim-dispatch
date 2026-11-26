# Recognizing profitable long-repair moves

Two published fleet policies sometimes dispatch the same loads but choose different empty moves. The short policy was fitted on short repairs. The long policy’s fit included four- and five-half-day repairs. This study trains a detector to answer two questions on their disagreements. How often will the long move earn more credits by Friday, and how large are the gains and losses? A forecast is available on every disagreement, including when the selected dispatcher sticks with short. [Frozen protocol and implementation](https://github.com/Arhaan2/evalsim-dispatch/tree/fd3adc75f8aa38a48bd9c72341707f9e22b8174b/training/longmove)

## Realized rewards and where the trucks actually go

For each training disagreement, the simulator takes the two actions on the same public board. Both branches dispatch the remaining loads using the frozen short policy, with identical future freight and repair notices. Subtracting the short branch’s final credits and contracts served from the long branch’s gives the two Monte Carlo targets. Nine ordered truck placements are tracked in the backward calculation because subsequent choices can depend on truck-ID tie breaks. Each selected full-week policy may take the long action at later disagreements too. [Trainer](fit.mjs)

Off-path boards allow the detector to learn from many possible depot placements. On-path boards show where an operator starting on Monday would actually face a disagreement. Each of the six canonical starting depot pairs receives weight one per disagreement, and the exact ordered position reached by the frozen short policy receives an additional weight of eight. An on-path canonical placement therefore receives nine, an on-path reversed placement receives eight, and each board and ordered placement appears at most once. The same weighting applies when calibrating predictions. Evaluation gives each week its registered weight.

The detector receives 55 public inputs. It reuses the earlier 49 inputs that describe the direction of the disagreement, the two old policies’ predictions, freight, elapsed closure, repair notices and demand forecasts. Six additional inputs estimate the serviceability and best immediate net earnings on the next board after each move, and the difference in each estimate between moves. These estimates enumerate possible signed loads, hub forecasts and open/closed states using public information at decision time. Realized next-board loads enter the simulator after the decision. [Public policy](../../docs/lib/longmove-policy.js)

## Four nonlinear predictions

| Head | Fitting rows | Target |
|---|---|---|
| Win probability | All disagreements | One if long earned strictly more, zero on a loss or tie |
| Gain on wins | Strict wins | Additional Friday credits |
| Downside on nonwins | Losses and ties | Friday credit shortfall, zero on a tie |
| Service change | All disagreements | Additional contracts served by Friday |

Each head starts at its weighted mean and learns 32 depth-two regression trees with a learning rate of 0.12. Each split maximizes the reduction in weighted squared error. Up to 15 empirical quantile cuts are considered per feature, using the rows eligible for that head. Both children need at least 24 distinct rows. A leaf stores its weighted mean residual. For the binary win head, the squared loss is the Brier score.

Each head is calibrated on a separate bank with weighted target and prediction means and a least-squares slope clipped to [0, 1.5]. The win forecast is limited to [0.005, 0.995] and both predicted magnitudes have a floor of zero. Multiplying the predicted win probability by the gain on wins and subtracting the probability of a nonwin times the downside gives the predicted net advantage. The flat control uses the four weighted calibration target means with the release settings. It can therefore expose a win-probability forecast even if the selected action always follows short.

Eighteen candidate rules combine a minimum win probability of 0, 0.40 or 0.55, a hurdle of 0, 2 or 5 credits, and a service weight of 0 or 12 credits per extra on-time contract. A switch must meet the probability minimum, exceed the earnings hurdle, and exceed that same hurdle after adding the service value. A nineteenth candidate follows short throughout. On policy-selection weeks each candidate starts at the original Monday placement and dispatches its own fleet to Friday. A switching candidate qualifies only with positive paired mean earnings minus one standard error and nonnegative mean service versus short. If several qualify, take the highest earnings bound, with ties in registered grid order. If none qualify, deploy the frozen short dispatcher.

## Sample sizes and reproduction

| Separate bank | Weeks per family | Weeks per checkpoint |
|---|---:|---:|
| Fit the trees | 8,192 | 90,112 |
| Calibrate forecasts | 2,048 | 22,528 |
| Choose a policy | 4,096 | 45,056 |

All three banks use eleven historical training freight families and new tape seeds. Closure starts are half-days 2, 4 and 6 (Monday morning is zero), with durations drawn uniformly from [1, 2, 3, 4, 4, 5, 5]. Friday ends the episode. Release seed 13 was designated before fitting, with seeds 37, 73, 101 and 211 measuring training variation. Each fit starts at 800,000,000 plus one million times its zero-based index. Calibration and selection banks begin 200,000 and 400,000 later. Within a bank, advance by its per-family count for each subsequent family.

The CPU reference runs used Node.js 24.18.0 on an Apple M4 Pro running macOS arm64. From the repository root, these commands refit and audit all five checkpoints. An optional final argument selects one registered seed.

```sh
node training/longmove/fit.mjs --check
node training/longmove/audit-fit.mjs
```

The independent audit dispatches each counterfactual forward through Friday. It reconstructs the experienced short-policy path, row weights, initial predictions and each tree’s residuals. At every node it scans the registered cuts in feature-sorted rows and checks whether the recorded split achieves the best allowed squared-error reduction. It verifies leaf values, calibrations and the full selection bank for every candidate. [Independent audit](audit-fit.mjs) · [Public benchmark](../../LONGMOVE.md)

## Fitted checkpoints

| Fit | Unique training disagreements | On the short-policy path | Long wins | Calibration disagreements | Selection setting | Selection switches |
|---|---:|---:|---:|---:|---|---:|
| [13](../../docs/data/longmove/fit-13.json) | 7,451 | 924 | 3,309 | 1,843 | Win ≥ 0.40, hurdle 5, service weight 0 | 45 |
| [37](../../docs/data/longmove/fit-37.json) | 7,379 | 880 | 3,321 | 1,884 | Always short | 0 |
| [73](../../docs/data/longmove/fit-73.json) | 7,423 | 892 | 3,433 | 1,954 | Always short | 0 |
| [101](../../docs/data/longmove/fit-101.json) | 7,501 | 884 | 3,397 | 1,896 | Win ≥ 0.00, hurdle 5, service weight 12 | 24 |
| [211](../../docs/data/longmove/fit-211.json) | 7,443 | 891 | 3,390 | 1,849 | Always short | 0 |

Release fit 13 learned from 7,451 distinct disagreements, including 924 encountered by the short dispatcher starting from Monday’s standard placement. Across those fitting rows, the long move won 3,309 times, tied 1,110 times and lost 3,032 times. After weighting, the separate calibration sample had a 47.24% win rate. Wins averaged 31.86 credits. Nonwins averaged a 28.14-credit shortfall, counting ties at zero. The flat control combines those estimates into a 0.20-credit gain on every disagreement, below the release’s five-credit hurdle. It therefore always follows short.

Ten of the eighteen active rules cleared the training selection thresholds for fit 13. Its selected rule switched 45 times across 45,056 selection weeks, yielding +0.0090 credits per week over short (+0.0050 after subtracting one standard error). It served seven additional contracts across those weeks. Fit 101 also selected an active policy. The other three fits selected short. These selection results describe training behavior. Fresh decisions and returns are reported in the benchmark. [Locked weights before fresh scoring](https://github.com/Arhaan2/evalsim-dispatch/tree/1b10573db095eb8a373a91fda12f09ff16649eaa/docs/data/longmove)
