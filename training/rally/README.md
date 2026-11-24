# Can a dispatcher distinguish a brief rally from a lasting turn?

On 8,192 fresh shifts, the learned demand model earned **0.64 more net credits per shift** than the distribution-aware planner overall. Both targeted markets still favored the planner. The learned model kept the original interrupted-drop advantage on a separate 1,024 shifts. We froze the training method, patterns, seed banks, checkpoints to publish and decision thresholds before fitting. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/rally.html) · [Frozen experiment](https://github.com/Arhaan2/evalsim-dispatch/tree/40598a8/training/rally)

## Booking results

Each entry is a mean per eight-wave shift. Intervals are paired across policies. Positive differences favor the learned demand model.

| Shift | Count | Model | Planner | Difference [95% interval] |
|---|---:|---:|---:|---:|
| Fresh cold-ending reversals | 2,048 | 47.30 | 47.84 | −0.54 [−0.94, −0.16] |
| Fresh hot-ending interrupted drops | 2,048 | 55.95 | 57.83 | −1.87 [−2.20, −1.51] |
| Original interrupted drop, new draws | 1,024 | 48.95 | 37.16 | +11.79 [+10.95, +12.67] |
| Fresh hot-ending reversals | 2,048 | 55.64 | 54.81 | +0.83 [+0.62, +1.06] |
| Fresh cold-ending interrupted drops | 2,048 | 49.34 | 45.22 | +4.12 [+3.54, +4.71] |
| All fresh patterns and endings | 8,192 | 52.06 | 51.42 | +0.64 [+0.42, +0.85] |
| Previous Trust cold-ending reversals, new draws | 2,048 | 47.68 | 48.71 | −1.03 [−1.46, −0.56] |
| Previous Trust hot-ending drops, new draws | 2,048 | 55.18 | 56.58 | −1.40 [−1.99, −0.80] |

Only original-drop retention passed among the three primary goals. On the original drop, the learned model earned +0.43 [+0.20, +0.67] against Trust, +0.11 [−0.12, +0.33] against Drift and +0.54 [+0.10, +0.97] against Turns. Every lower bound exceeded the declared retention threshold of −1 credit. The model averaged 52.04–52.06 credits across the five fits on all fresh markets. All five trained seeds trailed the planner on each of the two target endings. [Every case, baseline and training seed](../../docs/data/rally/results.json)

After scoring, we replayed the first disagreement on each target shift. On hot-ending drops the two agents made identical decisions on 1,138 shifts. On all 910 others the learned agent booked at the first disagreement while the planner waited. Those shifts accounted for the entire 3,836-credit shortfall. On cold-ending reversals, the learned agent waited at the first disagreement on 366 shifts and lost 1,502 credits across them. It booked at the first disagreement on 233 shifts and gained 391 credits. These are full-shift totals, including all later decisions. [Reproduce the breakdown](diagnose.mjs)

## Did the agent recognize persistence?

We asked for a probability of a hot close after the current offer and public bulletin, before making a booking. We held capacity open so both predictors saw all eight observations on every shift. The true closing label was available to the evaluator. Exactly half the fresh shifts closed hot. A constant 50% forecast therefore has a Brier score (mean squared probability error) of 0.250. Lower is better.

| After signed offer | Full model accuracy | Current-only accuracy | Full model Brier | Current-only Brier |
|---|---:|---:|---:|---:|
| Wave 1 | 50.0% | 50.0% | 0.269 | 0.269 |
| Wave 5 | 51.9% | 51.7% | 0.289 | 0.287 |
| Wave 6 | 58.5% | 55.7% | 0.263 | 0.246 |
| Wave 7 (prespecified) | 52.1% | 61.7% | 0.405 | 0.278 |
| Wave 8 | 61.7% | 79.4% | 0.340 | 0.190 |

At wave seven the full model assigned a mean 58.1% chance of a hot close to actual hot endings and 56.1% to actual cold endings. Its Brier improvement was −0.155 [−0.160, −0.149] against the constant forecast and −0.126 [−0.133, −0.120] against the current-only control. Both comparisons missed the prespecified detection target.

Its confidence in whichever ending it picked averaged 87.6% at wave seven, for 52.1% correct. On the 3,039 shifts it rated at least 90% likely to end hot, the actual hot share was 53.9%. These post-hoc summaries quantify its overconfidence on the new timings. [Forecast diagnostic](diagnose.mjs)

The seventh-wave bulletin reports a noisy reading of **wave five**. On two of the four new openings, both twins still shared the same demand level at wave five. On the early-rally pair, the market that eventually cooled was warmer at wave five than its hot-ending twin. Across that pair, the full model’s Brier score rose from 0.268 at wave six to 0.591 at wave seven. The later reading could be accurate about earlier demand and still point the model toward the wrong ending. The wave-seven measurement also includes a new signed offer.

A probability forecast and a profitable booking answer different questions. Compared with the separately fitted current-only policy, the model with history gained 0.24 credits [+0.17, +0.32] on fresh hot drops. On cold reversals the corresponding difference was −0.04 [−0.19, +0.11]. The two models differ in how they model future observations as well as which observations they retain.

## How the agent learns

The model-based RL agent first fits a demand model from synthetic training rollouts, then uses it to optimize the eight-step booking return. A training tape contains public signed prices and the surveys released at waves four and seven. Across repeated tapes from a given training market, the fitter estimates each wave’s high-price frequency and each survey’s distribution. Training-market IDs group the tapes; training ending labels annotate the components for the persistence readout and determine the prespecified fitting weights. The dispatcher receives only the offer, observed history, public price supports and surveys, wave and truck slots.

At decision time the agent updates its probability for each learned market from the sequence of signed prices and revised surveys. Its probability of a hot finish is the sum of the weights on hot-ending markets. It compares the expected credits from booking now with the expected credits from holding capacity. A finite-horizon Bellman calculation integrates over the possible later offers and surveys and the bookings the agent could make after seeing them. The policy is optimal for its fitted model. That model assumes offers and survey noise are conditionally independent given a training-market component. Realizations of this simulator also share seed-specific hot and cold odds. Unseen timing patterns can fall outside the fitted mixture.

The control independently fits transitions and closing-label probabilities from the current wave, signed price category and posted bulletin. It plans by integrating those transitions over the same public price support and remaining slots. It has access to the current survey, even when it describes earlier demand. The distribution-aware planner, Trust, Closes, Drift, Turns and adaptive planner are the unchanged published references.

## Training and evaluation design

Five fits use seeds 13, 37, 73, 101 and 211. Each samples 6,000 unique seeds from its own 12,000-seed block and crosses them with 19 training markets for 114,000 shifts. The full model and its control see the same 912,000 observations in each fit. A pass-through collection policy sees all freight offers, because bookings affect capacity and earnings while the market evolves independently. A half-count smooths the fitted probabilities.

Each fit gives the paired cold-ending reversals and hot-ending drops twice the ordinary weight, and gives three historical training-only cold drop recoveries triple weight. The resulting training mixture has a 36.4% hot-ending prior; the paired fresh test has a 50% share. This choice emphasizes the action targets and makes the calibration test on a balanced market more demanding. Seed 13 was designated for release before fitting. All ten fits were complete before scoring test trajectories.

The fresh set pairs four unseen openings with both endings across 1,024 common seeds. The agent never receives the family, ending, seed, true probabilities or future draws. The separate original-generator and archive checks also use untouched seeds. Each uncertainty interval uses 2,000 paired bootstrap resamples of whole seeds, retaining related patterns, endings and policy outcomes together. These intervals apply to this fixed pattern mix and the prespecified released fit.

## Reproduce

Run on CPU with Node.js 22 or later. The published experiment ran with Node.js 24.18.0 on macOS arm64. The audit refits every policy, replays the public comparisons and recomputes the per-wave diagnostic.

```sh
npm run audit:rally
node training/rally/diagnose.mjs
node --test test/rally-world.test.mjs test/rally-policy.test.mjs test/rally-benchmark.test.mjs
```

[Benchmark your own agent](../../RALLY.md) · [Training](fit.mjs) · [Learned booking policy](../../docs/lib/rally-policy.js) · [Evaluation](evaluate.mjs)
