# When should a fleet dispatcher stick with the constant penalty during a long repair?

## Decision and comparators

The previous closure agent had seen repairs lasting one to three half-days in training. On its first fresh test it earned 0.344 fewer credits per week than the constant-penalty dispatcher. On five-half-day repairs its observed shortfall was 1.633 credits. Each test schedule had its own mix of durations, so the earlier breakdown also reflected which freight patterns appeared at each duration. [Previous experiment](../closure/PROTOCOL.md)

Use the released two-truck, three-depot, ten-board simulator, legal menu, freight and incident randomness, missed-contract penalty, travel costs and planner. Every dispatcher sees the same public demand bulletin, warning, elapsed closure and any repair update. A delay bulletin is noisy and the true reopening time is hidden. The planner uses the published uniform prior over one to five half-days, conditional on public evidence. Keep the two baseline dispatchers frozen, including this prior. A gain over these baselines would therefore concern these specific dispatchers operating under a shifted duration distribution.

Compare the new policy with the rolling planner and the published closure-aware constant penalty on each identical week. The candidate can choose the prior closure agent's proposal or the constant policy's action only where they actually disagree. Elsewhere it takes their common action. A learned decision can change subsequent truck positions, legal moves and contracts served. The public benchmark accepts any legal joint dispatcher. Keep the original closure release, a constant-score version of the gate and a matched short-training checkpoint as secondary comparators.

## Simulator-based policy improvement

Use paired simulator rollouts to Friday close to learn the value of taking the old closure proposal instead of sticking with the constant penalty. Each branch takes its specified first action and uses the constant dispatcher thereafter on identical freight and repair observations. Track ordered truck positions in the continuation. Fit on eligible disagreements across six starting placement pairs, including placements off the benchmark policy's path. Regress paired net credits and paired contracts served using the previous proposal's estimates as offsets. The released policy can reconsider each later disagreement.

For each of eleven historical freight schedules use 768 fitting, 384 calibration and 768 policy-selection weeks. Index the five independent fits by the ordered seeds 13, 37, 73, 101, 211. Their seed blocks start at 600,000,000 plus 1,000,000 times the zero-based index. Within each block, fitting, calibration and selection start at offsets 0, 200,000 and 400,000. Family offsets within each bank equal family index times weeks per family. All those draws use morning starts 2, 4 or 6; epoch zero is Monday morning. Sample uniformly from the duration list [1,2,3,4,4,5,5]. A repair that runs past Friday close contributes only outcomes through the final board. Release fit 13 regardless of its results.

Use public-state features, standardized ridge regressions (0.02 penalty per row) and separate calibration of the two heads with fitted slopes clipped to [0,1.5]. Compare the constant policy with the grid of service weights [0,12,30] credits per contract and score hurdles [0,2,5] credits. Select configurations with nonnegative mean paired service against both baselines on whole selection weeks. Among those, maximize the worse of the two paired mean net advantages minus one standard error. If none qualify, maximize the smaller of the two service differences, then use the earnings criterion. Tie order prefers the constant policy and proceeds in grid order. A zero proposal score defers to the constant penalty. The source frozen with this protocol fixes the features, calibrators and exact numeric rules.

Fit one additional seed-13 checkpoint with the same features, counts, seeds and selection procedure. Only the fitting duration list changes to [1,2,3]. Both versions use the identical mixed calibration and selection weeks. Their difference measures the incremental value of fitting on longer repairs at this training seed. Also evaluate the release with its two state-dependent calibrated predictions replaced by their training-calibration means while keeping its selected decision settings. Clear and reopened boards delegate to the original constant policy in every version.

## Registered public weeks

All six new market patterns are disjoint under depot relabeling from each other and all earlier fleet patterns. Adjacent families within each bank start 10,000 seeds apart. Draw freight and repair information separately. Every family in a bank uses the same repair profile. In the test, two thirds of the duration draws in expectation last four or five half-days; all durations fit within the week. The exact duration is an evaluator label only.

| Bank | Freight patterns in manifest order | Start epochs | Duration list, sampled uniformly | Weeks per pattern | First seed |
|---|---|---|---|---:|---:|
| Validation | prolonged-loop 0012122200, prolonged-transfer 0001222110 | 1 | 1,2,3,4,4,5,5 | 128 | 650,000,000 |
| Fresh test | prolonged-return 0012200011, prolonged-relay 0112221001, prolonged-backtrack 0001121010, prolonged-rally 0010211122 | 3,5 | 1,2,3,4,4,4,5,5,5 | 2,048 | 660,000,000 |
| Clean | Same four fresh schedules | No incident | — | 512 | 670,000,000 |
| Double-return | Original double-return 0011002200 | No incident | — | 4,096 | 680,000,000 |

## Decision criteria and diagnostics

Publish this design and scoring code before fitting, then lock all six checkpoints publicly before scoring. For the preselected release the joint claim requires every following criterion.

1. Fresh net credits per week exceed the rolling planner, with a strictly positive lower paired 95% bound.
2. Fresh net credits per week exceed the constant penalty under the same rule.
3. The mean on-time difference and its lower paired 95% bound against the planner both reach zero percentage points or higher.
4. The same zero-shortfall service test passes against the constant penalty.
5. On new draws of the original double-return schedule, the lower paired 95% bound on net credits versus the planner is strictly positive.

Each week has ten due contracts including any made infeasible by a closure. Use paired two-sided percentile intervals from 2,000 within-schedule bootstrap resamples of entire weeks with seed 9713. Report individual intervals without a multiplicity adjustment. The joint decision is a conjunction. These intervals describe variation over simulated weeks conditional on these specific schedules and checkpoints.

Report all five mixed-duration fits, all reference results, and disaggregate the release by freight pattern, by individual repair duration, and by short (1–3) versus long (4–5) repairs. Comparisons with the matched short fit and with the constant-score gate are secondary. Count eligible proposals on the release trajectory and how often the gate accepts or defers. On every fresh week, fork all real disagreements on the release trajectory. Publish paired decision examples after replaying both actions and following the release dispatcher through Friday. Select the eligible example nearest the group's median for each nonempty combination of adoption/deferral and positive/negative outcome, with ties in manifest/round order. State the denominator and continuation for examples. Full-week rollouts determine the primary scores. On the original double-return bank verify action-by-action equality to the historical constant policy. Any retained win there belongs to this inherited behavior.
