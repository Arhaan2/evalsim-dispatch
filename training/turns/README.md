# Did a policy trained on changing demand repair the reversal failure?

The released policy earned **48.88 credits per shift** across 1,024 shifts with unseen turn timings. The original distribution-aware planner earned **44.48**. The paired difference was **+4.39** (95% interval +3.54 to +5.21). The policy also improved on the previous Drift checkpoint across the two fresh reversal patterns. Preservation of the earlier policy’s performance on fresh interrupted drops remains inconclusive under the prespecified one-credit tolerance. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/turns.html) · [Benchmark your agent](../../TURNS.md)

## New demand paths

Each score is mean signed freight revenue less handling costs across the same offers. The four test patterns each contributed 256 shifts. The distribution planner optimizes against the full posted odds. The adaptive planner first corrects those odds using recent forecast errors. Both planners and the previous Drift RL checkpoint are the original released implementations.

| Fresh patterns | Turn RL | Previous Drift RL | Distribution planner | Adaptive planner | Matched RL without history |
| --- | ---: | ---: | ---: | ---: | ---: |
| Early crest | 44.74 | 36.70 | 45.45 | 39.99 | 47.23 |
| Late crest | 52.22 | 55.27 | 52.89 | 48.33 | 53.16 |
| Early rebound | 47.83 | 49.20 | 32.32 | 32.40 | 46.48 |
| Late rebound | 50.71 | 50.35 | 47.28 | 45.60 | 50.80 |
| All fresh shifts | **48.88** | **47.88** | **44.48** | **41.58** | **49.42** |

Turn RL beat the distribution planner on 364 shifts, tied on 332, and lost on 328. The gain against the adaptive planner was +7.29 credits (95% interval +6.26 to +8.25). Early crests explain most of the gain over Drift RL on reversals. On late crests the previous policy earned 3.05 more credits per shift.

## Reversal repair and interrupted-drop retention

The feature definitions, case manifest, release seed and criteria were frozen before the test. The release used seed 13 regardless of validation performance. The joint criterion required all four checks below. The margin for a material regression was fixed at one synthetic credit per shift. [Frozen protocol and features](https://github.com/Arhaan2/evalsim-dispatch/tree/27dc9fa/training/turns)

| Prespecified check | Turn RL minus distribution planner, 95% paired interval | Turn RL minus previous Drift RL, 95% paired interval | Outcome |
| --- | ---: | ---: | --- |
| Higher mean return than the planner on all fresh shifts | +4.39 [+3.54, +5.21] | +0.99 [+0.32, +1.68] | Passed |
| Higher mean return than previous RL on the fresh reversal stratum | −0.69 [−1.38, +0.04] | +2.49 [+1.40, +3.54] | Passed against previous RL. A planner advantage remains plausible. |
| Keep the planner advantage and stay within one credit of previous RL on fresh rebounds | +9.47 [+8.00, +10.87] | −0.51 [−1.13, +0.17] | Inconclusive against the one-credit tolerance |
| Same retention checks on the original interrupted-drop pattern with fresh seeds | +10.35 [+8.51, +12.22] | −0.21 [−0.92, +0.63] | Passed |

On the separate **original reversal** diagnostic (256 fresh seeds), Turn RL earned 52.06, the previous Drift policy 42.02, and the distribution planner 52.42. The change from the previous RL policy was +10.04 [+8.35, +11.71]. The gap to the distribution planner was −0.36 [−1.06, +0.29]. Both original-pattern diagnostics reuse the exact original Drift generator on seeds 9400000–9400255. They are reported separately from the four new test paths.

## What the policy learned

The agent estimates the value of keeping an additional truck slot open. A signed offer at or above that learned reservation value earns a booking. The learned table conditions on time remaining, available capacity, the quoted support and odds, the current signed high or low outcome, and public history. A turn signal compares the share of high offers in the latest two signed offers, including the current one, with the share in earlier waves. Each rate has one pseudo-observation at the opening bulletin probability. The model also uses an earlier bulletin and the order of the last two previous high/low outcomes. These features can change after each signed offer.

Training used sample-based fitted afterstate value iteration. The known two-slot booking rule supplies the action consequences: waiting keeps all slots and accepting earns the signed net value while consuming a slot. The environment reveals every signed offer regardless of booking, so a pass-only training rollout supplies a valid market transition for every feasible capacity. The trainer uses these public trajectories to fit continuation values. It never uses the path label as a policy feature, the hidden demand rates, or the realized future of a deployment decision. This is a hybrid of learned stochastic continuation values and known booking mechanics.

For a future signed offer of value `x`, let `D1` and `D2` denote the continuation values of the first and second additional slot. The Bellman target for the first spare slot is `max(x, D1)`. For the second it is `max(D2, min(x, D1))`. At the final wave both continuation values are zero. Working backward, the algorithm estimates these targets across training transitions that share public feature prefixes. A child estimate shrinks toward the parent with 32 pseudo-observations. This supplies values for rare histories and a fallback for unseen combinations. The algorithm fits both marginal values from the same samples.

## Did the history features help?

The ablation fits **a second model on the same training tapes**, with the same clock, slot rules, current offer, price support, current posted probability, estimator and shrinkage. It omits earlier offers and bulletins. The full model earned **0.54 fewer credits overall** [−0.82, −0.28]. Its history features added **0.63 credits on fresh rebounds** [+0.25, +1.04] and cost **1.71 on fresh crests** [−2.26, −1.19]. Training on paths that cool before closing provides useful timing information even without inspecting the history. The aggregate gain over the distribution planner cannot be credited to turn sensing alone.

The released policy did respond to observed history. At wave four, two early-crest test cases offered the same 28 credits with one slot left, the same current bulletin and identical published future forecasts. On seed 9300000 the three earlier offers were 9, 8 and 24 credits, and the learned threshold was 27.46. The agent booked. On seed 9300111 the earlier offers were 18, 22 and 6, and the threshold rose to 28.30. The agent passed. Across the test, eight of 225 matched public contexts had decisions in both directions, accounting for 188 of the 5,718 decisions with capacity left. These matches demonstrate sensitivity to history. They do not measure the accuracy of a classifier for latent turns.

## Splits, uncertainty and reproduction

The six training patterns contain shallow, brief and sustained turns in both directions. Timing vectors differ across training, validation, fresh test and all prior Drift templates. All fresh patterns share the original freight supports, noisy bulletin mechanism, eight-wave horizon and two truck slots. The equal test pattern weights and cooling tails limit the scope of the average.

Five fits used disjoint 12,000-seed blocks within 9100000–9159999. Within each block, a seeded sampler drew 12,000 market seeds with replacement and crossed each draw with all six patterns. Each fit covered 72,000 public trajectories and 576,000 simulator calls. Distinct sampled seed counts ranged from 7,593 to 7,642. Each ablation reused the collected transitions. Validation used 64 seeds and two separate patterns. The fresh test used seeds 9300000–9300255. All models were frozen before evaluation.

| Training seed | Validation credits | Fresh test credits |
| --- | ---: | ---: |
| 13 (released) | 47.42 | 48.88 |
| 37 | 47.69 | 48.99 |
| 73 | 47.33 | 48.85 |
| 101 | 47.40 | 48.75 |
| 211 | 47.45 | 48.92 |

Intervals use 2,000 paired bootstrap draws of whole scenario seeds. Each draw keeps all associated patterns and operator scores together. They quantify scenario variation conditional on the released fit and selected patterns. Per-pattern intervals are descriptive and unadjusted for multiplicity. A passing retention check rules out a loss greater than the declared tolerance at that interval, not every possible loss.

The reference run used Node.js 24.18.0 on macOS arm64 CPU. Run these commands in the source checkout using Node.js 22 or later.

```sh
node training/turns/run.mjs --check
node --test test/turns-policy.test.mjs
```

The audit refits all ten models, verifies each freight ledger, and compares scores, intervals, both released checkpoints and diagnostic cases against the published artifact. [Training implementation](run.mjs) · [Machine-readable results](../../docs/data/turns/results.json)
