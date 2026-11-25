# Learning which overnight moves lose money

The fleet has two trucks, three depots and four nights to reposition before Friday close. This study asks whether a dispatcher can identify costly proposals from an earlier RL policy, earn more net credits than both the rolling planner and the published constant penalty, and maintain their on-time service. The secondary target is to retain a positive net advantage over the planner on fresh draws of the original double-return schedule. [Interactive study](https://arhaan2.github.io/evalsim-dispatch/loss.html) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#loss)

## Results on fresh weeks

The preselected agent earned **0.58 more credits per week than the planner** and delivered **0.184 percentage points more contracts on time**. It retained the double-return win. Against the historical constant-penalty agent it earned 0.12 fewer credits per week on average. The interval for that comparison includes both a loss and a gain. The joint criterion was missed. [All five locked checkpoints before scoring](https://github.com/Arhaan2/evalsim-dispatch/tree/e6c8e6be7778f6d117a2b3412821ad12924ec6b6/docs/data/loss) · [Scored weeks and paired intervals](../../docs/data/loss/results.json)

| Bank and comparator | Release minus comparator in net credits/week [95% interval] | Release minus comparator in on-time percentage points [95% interval] | Weeks won / tied / lost on earnings |
|---|---:|---:|---:|
| Fresh · rolling planner | +0.58 [+0.09, +1.06] | +0.184 [+0.100, +0.271] | 703 / 6,889 / 600 |
| Fresh · historical constant penalty | −0.12 [−0.35, +0.10] | +0.046 [+0.010, +0.083] | 141 / 7,904 / 147 |
| Fresh · matched constant loss probability | +0.04 [−0.05, +0.12] | +0.011 [−0.001, +0.023] | 23 / 8,154 / 15 |
| Double-return · rolling planner | +2.11 [+1.34, +2.90] | +0.447 [+0.310, +0.586] | 482 / 3,279 / 335 |

On the release agent's path, the earlier override agent proposed a change on 1,647 of 32,768 overnight boards. Of those proposals, 757 would lose credits under the registered continuation. The loss predictor's Brier score was 0.2470, against 0.2485 for a constant 47.04% forecast. Its ROC AUC was 0.539, where 0.5 indicates chance ranking. For 1,637 of the 1,647 proposals its probability fell between 40% and 60%. Replacing its probability with the calibration prevalence changed 38 choices on those boards. Separate full-week rollouts show a small, unresolved earnings difference for that substitution. These results support limited discrimination and leave its incremental policy value uncertain.

Across the other four fits, fresh-week gains over the planner ranged from +0.22 to +0.83 credits. Gains relative to the historical constant penalty ranged from −0.47 to +0.13, and service differences against that control ranged from −0.068 to +0.082 percentage points. The public results include every fit and schedule. [Compare the fits and replay decisions](https://arhaan2.github.io/evalsim-dispatch/loss.html#results)

## What the agent learns

Each training comparison starts on a night when the original fleet override agent actually proposes an alternative. The proposal preserves the planner's signed freight assignments. The simulator tries both actions on exactly the same sequence of future freight. After that first choice, both branches use the previously published constant-penalty dispatcher through Friday. Their terminal difference measures the cost or benefit of accepting this particular override under a fixed continuation. Labels depend on later travel and missed contracts as well as the cost of tonight's trip. A strictly negative net difference is a loss. Exact ties belong to the nonloss class.

This is offline, simulator-based Monte Carlo policy improvement. Four ridge regressions estimate the probability of a loss, its magnitude conditional on losing, the return conditional on avoiding a loss, and the signed change in contracts served. All four heads use the same 114 public features. Before fitting, a simple one-morning model projects demand from the public bulletin and past realized hubs. It enumerates 18 possible boards and values the best immediate legal response from each of the proposal's and planner's ending placements. The regressions correct those probability and credit estimates toward realized Friday outcomes. The service regression starts with the frozen predecessor's expected service difference. Each regression uses a 0.01 ridge penalty per example on all terms except its intercept. [Feature and action code](../../docs/lib/loss-policy.js) · [Training code](fit.mjs)

The binary head minimizes squared error on loss indicators. Its clipped probability goes into one of ten equal-width bins on a separate calibration bank. Each bin receives ten pseudo-observations at its midpoint. Weighted isotonic regression pools adjacent bins when their estimated loss rates would decrease. The agent values a proposal by multiplying its conditional nonloss gain by the probability of avoiding a loss, then subtracting its conditional loss size times the probability of losing. The deployed score mixes that return with the previous dispatcher's estimate, adds a selected service value, and deducts a fixed earnings hurdle. A score above zero accepts the proposal. All other scores keep the planner's assignment.

The simulator and economics are unchanged. The learned agent acts only on the earlier override agent's disagreements. Benchmark entrants may choose any legal action on every board. The benchmark includes two constant controls. The historical control uses the previous uncertainty study's exact coefficients and flat 1.73-credit penalty. The matched control runs the new policy with its conditional probability replaced by the fixed training-calibration loss frequency. Its severity estimates, service estimate, blend and hurdle stay identical. [Agent interface and baseline keys](../../LOSS.md)

## Five fits and a preselected release

Before training, the protocol fixed fit 13 as the public release. Each fit uses 11,264 simulated weeks across eleven training schedules. The fitter enumerates eligible overnight choices from six starting truck-placement pairs. After either initial choice it tracks all nine ordered placements so the suffix dispatcher's tie handling preserves truck identity. Another 5,632 weeks supply the calibration observations. Finally, 8,448 separate weeks compare the planner and 18 whole-week policy settings. Selection keeps options whose paired service gain over the planner minus one standard error is at least zero, then maximizes weekly net gain over the planner minus one standard error. [Pre-training freeze](https://github.com/Arhaan2/evalsim-dispatch/tree/1098a8c37dce98cfc65bf8e7a5cadde8f207c978/training/loss) · [Frozen primary checkpoint](../../docs/data/loss/model-13.json)

| Fit | Training proposals | Losing proposals | Exact ties | Calibration proposals | Calibration loss rate | Learned-return share | Credits per additional contract | Hurdle in credits |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 13 | 17,058 | 8,026 | 82 | 8,457 | 47.04% | 0.5 | 15 | 0 |
| 37 | 16,949 | 7,696 | 103 | 8,392 | 47.24% | 0.5 | 0 | 0 |
| 73 | 17,123 | 7,840 | 101 | 8,365 | 45.91% | 1 | 35 | 0 |
| 101 | 16,960 | 7,801 | 85 | 8,610 | 45.12% | 0.5 | 35 | 2 |
| 211 | 16,950 | 7,859 | 92 | 8,321 | 46.02% | 1 | 0 | 0 |

The public test compares policies on the same 8,192 synthetic weeks across four unseen schedules. A second bank repeats the original double-return schedule on 4,096 fresh draws. Each policy drives its own fleet through the entire week. Confidence intervals use 2,000 bootstrap resamples of paired weeks within schedule and describe variation on those schedules for the fixed policies. The protocol requires a positive lower earnings bound against both main controls, on-time service at least level with each at a zero-shortfall margin, and a positive lower earnings bound over the planner on double-return. [Full decision rules](PROTOCOL.md)

## Reproduce the study

Run these commands from the repository root with Node.js 22 or newer. The study uses the standard library and CPU. Training ran on macOS arm64 with Node.js 24.18.0.

```sh
node training/loss/fit.mjs --check
node training/loss/audit-fit.mjs
node training/loss/run.mjs --check
node training/loss/audit.mjs
```

The training audit runs both forced branches forward from their actual truck positions, verifies first-order equations for all 20 learned heads, reconstructs the calibrated probabilities by an independent isotonic formula, and replays the 802,560 training-only policy-selection paths. Together the five fits contain 85,040 labeled training proposals and 42,145 calibration comparisons. [Fit audit](audit-fit.mjs) · [Independent ledger audit](audit.mjs) · [Benchmark your own agent](../../LOSS.md)
