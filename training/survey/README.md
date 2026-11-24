# Does a dispatcher learn when the survey points the wrong way?

The new dispatcher beat the distribution-aware planner on fresh **cold-ending reversals**. The planner retained its lead on **hot-ending interrupted drops**. On the original interrupted drop, the new agent beat the planner by 8.88 credits per shift and gave back 2.95 credits against the previous Rally agent. The agent passed both tests of its forecasts. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/survey.html) · [Protocol and code frozen before fitting](https://github.com/Arhaan2/evalsim-dispatch/tree/5b8b5f6/training/survey)

## Did the bookings improve?

Policies face the same eight offers and have room for two bookings. Each difference below is the new policy’s mean net freight credits per shift minus the comparison policy’s. Brackets give paired 95% intervals.

| Markets | Shifts | Survey agent | Planner | Difference vs planner | Difference vs Rally |
|---|---:|---:|---:|---:|---:|
| Fresh cold-ending reversals | 2,048 | 45.63 | 44.79 | +0.84 [+0.56, +1.12] | +0.94 [+0.63, +1.27] |
| Fresh hot-ending drops | 2,048 | 55.52 | 56.56 | −1.04 [−1.37, −0.69] | +0.71 [+0.55, +0.88] |
| Original interrupted drop, new seeds | 1,024 | 45.38 | 36.50 | +8.88 [+8.12, +9.65] | −2.95 [−3.46, −2.45] |
| All fresh endings | 8,192 | 48.78 | 47.61 | +1.17 [+1.00, +1.36] | +0.01 [−0.10, +0.13] |
| Earlier Rally cold-ending reversals, new seeds | 2,048 | 47.86 | 47.60 | +0.26 [−0.03, +0.57] | +0.55 [+0.23, +0.90] |
| Earlier Rally hot-ending drops, new seeds | 2,048 | 55.91 | 57.59 | −1.68 [−1.98, −1.34] | +0.06 [−0.07, +0.18] |

The frozen booking test required both target endings to beat the planner separately and the original drop to retain the gains of four historical agents within one credit. On the original drop the new policy was 2.47 credits below Trust [−2.94, −2.00], 2.75 below Drift [−3.30, −2.22], and 2.35 below Turns [−2.98, −1.70], in addition to its gap against Rally. One of three booking targets passed. Across all five training seeds, the cold-reversal mean ranged from 45.49 to 45.64 and the hot-drop mean from 55.52 to 55.55. The published policy was always seed 13. [All case scores, intervals and seeds](../../docs/data/survey/results.json)

## Does the agent recognize a misleading survey?

At wave seven the new bulletin measures wave five. A posted probability above 50% points to a hot finish; below 50% it points to a cold one. We call a bulletin misleading **as a closing signal** if its direction is opposite the shift’s actual closing regime. It may accurately describe the earlier market it measured. The fresh paired set contains 4,096 shifts of each ending. The booking policies see no ending labels during a shift.

| Wave-seven forecast across 8,192 fresh shifts | Accuracy | Mean confidence in picked ending | Brier error |
|---|---:|---:|---:|
| Survey agent | 68.1% | 71.5% | 0.2025 |
| Previous Rally agent, same shifts | 59.0% | 89.8% | 0.3553 |
| Follow the published survey odds | 60.9% | 63.9% | 0.2384 |
| Ignore surveys and learn from signed offers | 67.6% | 73.0% | 0.2022 |

Brier error is the squared difference between predicted probability and outcome, averaged over shifts. A constant 50% forecast scores 0.2500. The new model reduced error by 0.1528 [0.1477, 0.1581] against Rally and reduced the mean overconfidence gap from 30.8 to 3.3 percentage points. Both were assessed on the same fresh shifts. Against the separately trained signed-offers-only control, the error reduction was −0.00025 [−0.00192, +0.00153]. On these shifts we could not establish an additional forecast benefit from including the survey. On the older Rally patterns the signed-offers-only control had lower error (0.2013 versus 0.2095).

Of 6,715 directional bulletins, 2,468 pointed to the wrong ending. The remaining 1,477 fresh shifts had neutral bulletins and are excluded from the warning test. The learned agent assigned an average 60.3% risk to bulletins that proved misleading and 37.7% to those that proved aligned. Its warning AUROC was **0.749 [0.736, 0.762]**. In a random pair consisting of one misleading bulletin and one aligned bulletin, the agent ranked the misleading one higher about three quarters of the time, counting ties as half. It also reduced warning Brier error by 0.0481 [0.0423, 0.0538] against a constant 50% risk. Both prespecified checks passed. A threshold of greater than 50% risk flagged 3,068 bulletins, of which 1,692 were misleading. Across all directional cases the agent estimated 46.0% risk on average against an observed rate of 36.8%.

For hot-pointing readings AUROC was 0.781; for cold-pointing readings it was 0.721. On the archive the overall AUROC was 0.754 [0.740, 0.767]. Every cold-pointing archive reading had the same outcome relative to the bulletin, so the within-direction AUROC there is undefined. [Explore the forecast comparisons](https://arhaan2.github.io/evalsim-dispatch/survey.html#survey-reliability)

## When did the survey change a booking?

The always-use control treats new posted odds as a forecast of the ending. The never-use control omits survey readings and uses signed offers. Each fits its own future booking values on the same training tapes. At the 25,289 fresh decisions with a directional survey and at least one open slot, the controls disagreed on 1,985. The learned policy chose the always-use action 888 times and the never-use action 1,097 times. The comparisons use the same observed history and remaining capacity reached by the learned policy.

On cold reversals the learned policy earned +0.76 credits [0.44, 1.03] against the separately trained never-use policy. On hot drops the difference was +0.062 [−0.002, +0.118]. In a post-hoc intervention we held the learned agent’s booking values fixed and replaced only its hot-ending probability with the literal posted odds once a delayed survey was available. That substitution earned an extra 0.33 credits per cold reversal and 0.58 per hot drop on this test. The headline booking win applies to the whole fitted agent. This intervention does not support attributing that win to its probability estimate alone.

On hot drops the learned agent booked at its first disagreement with the planner on 856 shifts, losing 2,142 credits in total on those complete shifts. It waited at the first disagreement on three shifts and gained 14 credits. On cold reversals the learned agent booked at the first disagreement on 330 shifts and gained 1,975 credits. On 37 it waited and lost 262. The same tendency to book early had different consequences in the two markets. [Replay the post-hoc diagnostics](diagnose.mjs)

All 859 first disagreements on the hot-drop test occurred before the final survey arrived. On the original interrupted drop, all 258 shifts where the Survey and Rally policies differed also first diverged before wave seven. On each of those shifts the Survey agent passed an offer that Rally booked. They accounted for the full 3,016-credit gap to Rally. Better forecasts at wave seven came too late to revisit those earlier decisions.

## What was trained?

A supervised forecast estimates the probability of a hot ending from the public prefix: the wave, recent high/low signed offers, older offer counts and, when enabled, the direction, strength and change of released bulletins. Sparse estimates shrink toward less specific observations. A second set of training-only markets and seeds calibrates the forecast by pooling adjacent probability bins to preserve monotonicity. The warning uses that same estimate: for a hot-pointing bulletin its risk is one minus the estimated hot probability, and for a cold-pointing bulletin its risk is the hot probability. Neutral and opening bulletins have no directional warning.

The booking policy uses offline reinforcement learning. Working backward through the eight waves, it estimates the future freight credits lost by using a slot now. It learns those values separately for hot and cold training outcomes under its own downstream decisions, using realized rewards and both feasible capacities on the observed tapes. Market offers evolve independently of the booking, so the same tape supplies the two continuations. At deployment the policy mixes those conditional costs using its calibrated ending probability and the prespecified training priorities. It books if the current signed offer covers the resulting slot cost. The market family, true odds, future survey, future offers and closing label are unavailable to the dispatcher.

Each of five fits uses a disjoint 12,000-seed block. Eighteen training openings in both endings and 2,000 sampled seeds supply 72,000 tapes for the outcome predictor. Six different paired openings and 1,000 different seeds supply 12,000 tapes for calibration. Both are evenly balanced between hot and cold endings. The booking fit includes three additional historical training-only cold recoveries, bringing its total to 78,000 eight-wave tapes per fit. The reward fit weights cold reversals and hot drops fourfold and original-like recovery training shifts sixfold. This targeting applies to bookings; predicted ending probabilities use the balanced training sample.

The post-hoc comparison of the raw and calibrated new forecasts at wave seven gave Brier errors of 0.2008 and 0.2025, respectively. The large improvement over Rally belongs to the new training method as a whole. The final calibration step alone slightly worsened fresh Brier error on this split.

## Reproduce the evidence

The release uses CPU-only Node.js and public synthetic freight. All 15 fits and the release checkpoint were fixed before scoring the test, guard and archive. Each confidence interval resamples 1,024 whole seeds 2,000 times within its split, keeping applicable siblings and policy results together. Warnings with no direction are excluded. The intervals concern these specific scenarios and the prespecified released seed. The post-hoc trace analysis uses the frozen checkpoint.

```sh
npm run audit:survey
node training/survey/diagnose.mjs
node --test test/survey-world.test.mjs test/survey-policy.test.mjs test/survey-benchmark.test.mjs
```

[Benchmark your own agent](../../SURVEY.md) · [Frozen protocol](protocol.mjs) · [Fitting](fit.mjs) · [Inference and booking](../../docs/lib/survey-policy.js) · [Scoring and diagnostics](evaluate.mjs)
