# Learning when to buy at a posted price

The dispatcher can buy a fresh survey before seeing the sixth of eight signed offers. Six independent samples of the current market produce a count from zero to six. A purchase is useful when the information changes later freight bookings enough to pay its price. The dispatcher sees the price from the beginning, so it can also change how much capacity it keeps available.

The market families, price grid, planner, fit procedure, selection rule, release seed and outcome criteria were published before fitting. [Frozen protocol and source](https://github.com/Arhaan2/evalsim-dispatch/tree/897dd828cb38864efa585e3eeb8f982e51ca7fd4/training/tariff)

## Results

**Original interrupted-drop gains were retained.** Both fresh target comparisons had small positive estimates and intervals spanning zero. The study missed its joint target. Over all four fresh market groups the Bayesian planner earned 0.17 more net credits per priced run.

| Market | Distinct tapes | Priced runs | Agent | Bayesian planner | Agent minus planner (paired 95%) |
|---|---:|---:|---:|---:|---|
| All fresh shifts | 4,096 | 28,672 | 51.41 | 51.58 | −0.17 (−0.25 to −0.09) |
| Fresh hot-ending drops | 1,024 | 7,168 | 55.82 | 55.80 | +0.02 (−0.07 to +0.09) |
| Fresh cold reversals | 1,024 | 7,168 | 47.62 | 47.59 | +0.03 (−0.10 to +0.17) |
| Fresh cold-ending drops | 1,024 | 7,168 | 46.90 | 47.39 | −0.49 (−0.76 to −0.23) |
| Fresh hot reversals | 1,024 | 7,168 | 55.32 | 55.54 | −0.22 (−0.30 to −0.15) |
| Original interrupted drop | 1,024 | 7,168 | 48.22 | 48.41 | −0.20 (−0.33 to −0.09) |
| Earlier hot drops, new draws | 512 | 3,584 | 53.89 | 53.78 | +0.12 (−0.08 to +0.31) |
| Earlier cold reversals, new draws | 512 | 3,584 | 45.93 | 45.90 | +0.03 (−0.02 to +0.08) |

On the exact original drop, the agent beat the legacy planner, Booking and Survey and stayed within the prespecified one-credit margin against each historical reference. The Bayesian planner still earned 0.20 more credits per priced run on that generator.

| Original-drop reference | Agent minus reference, net credits (paired 95%) |
|---|---|
| Legacy stochastic planner | +11.22 (+10.37 to +12.11) |
| Booking | +1.17 (+0.82 to +1.53) |
| Survey | +2.81 (+2.32 to +3.33) |
| Previous Paid learner at the posted fee | −0.21 (−0.36 to −0.09) |
| Rally | −0.18 (−0.30 to −0.09) |
| Trust | +0.28 (+0.07 to +0.50) |
| Drift | −0.09 (−0.33 to +0.15) |
| Turns | +0.29 (−0.17 to +0.74) |
| Tariff-aware Bayesian planner | −0.20 (−0.33 to −0.09) |

## What the price changed

On the 4,096 fresh tapes the release made 1,243 free purchases. Across the six positive tariffs it bought 264 times in 24,576 priced runs, on 90 distinct tapes. Forcing a skip on those 264 purchases changed 28 remaining booking sequences. All 264 purchases occurred with one open truck slot. The 18 tapes with a purchase at 0.75 also had a purchase at 0.50. [Play a price threshold](https://arhaan2.github.io/evalsim-dispatch/tariff.html#price-example)

| Price in credits | Agent buys | Planner buys | Agent fees, total credits | Agent net per run | Optional minus forced skip (paired 95%) |
|---:|---:|---:|---:|---:|---|
| 0.00 | 1,243 | 526 | 0.00 | 51.415 | +0.005 (−0.017 to +0.029) |
| 0.05 | 90 | 297 | 4.50 | 51.421 | +0.012 (−0.007 to +0.033) |
| 0.10 | 82 | 91 | 8.20 | 51.417 | +0.008 (−0.011 to +0.029) |
| 0.25 | 56 | 0 | 14.00 | 51.409 | −0.0005 (−0.017 to +0.016) |
| 0.50 | 18 | 0 | 9.00 | 51.412 | +0.003 (−0.006 to +0.015) |
| 0.75 | 18 | 0 | 13.50 | 51.411 | +0.002 (−0.006 to +0.013) |
| 1.00 | 0 | 0 | 0.00 | 51.409 | +0.000 (+0.000 to +0.000) |

At positive prices, actual purchases added 150.00 gross credits and cost 49.20 in fees versus skipping on the same openings. The net gain was 100.80 credits across all 24,576 offered runs, or +0.0041 per run (paired 95% interval −0.0068 to +0.0167). Forced buys cost substantially more, with the optional rule ahead by +0.4355 per run (+0.4179 to +0.4522). The optional policy responded to price. Its net advantage over always skipping remains uncertain on these markets. The contemporary six-sample count can guide a booking without resolving how demand will end.

For example, on step-rebound-hot seed 16300086 the agent reached the same five-offer history and one open slot at prices of 0.05 and 0.10. It valued the reading at about 0.071 credits before seeing it. At 0.05 it bought, saw two high responses, waited at wave six and finished with 61.95. At 0.10 it skipped, booked at wave six and finished with 52. A five-cent purchase on seed 16300063 earned 51.95 where skipping would have earned 60. These are worked examples of realized outcomes. The paired aggregate above includes every tape and price.

Seeds 13, 37 and 73 selected the profile that emphasized hot drops and recovery analogues. Seeds 101 and 211 selected the profile emphasizing all three target groups. Fresh hot-drop point differences across the five fits ranged from −0.004 to +0.080 against the price-aware planner. Fresh cold-reversal differences ranged from +0.004 to +0.495. The reported intervals above refer to the release seed specified before training.

## What was trained

Five independent finite-horizon reinforcement learning fits use seeds 13, 37, 73, 101 and 211 and disjoint 12,000-seed training blocks. Each fit uses 2,000 seeds across 42 training families for late freight returns (84,000 tapes). A different 2,000 seeds across those families supply purchase and pre-survey returns (84,000 tapes × seven prices). A third set of 1,000 seeds across 15 separate training families supplies 105,000 priced selection runs. Public evaluation draws and families are excluded.

The simulator lets the learner pair the consequences of booking and waiting, and of buying and skipping, on a common tape. At fitting time, integrate all seven potential survey counts with their conditional binomial probabilities, and replace the final offer with its conditional expectation. This reduces noise in the return targets. Only public observations reach the deployed agents. Selection and evaluation use the single realized survey and final signed price on each tape.

Starting from the end of the shift, fit late freight continuation values for both remaining capacities and for a visible or withheld reading. On independent training tapes fit the expected gross returns of buying and skipping before either the reading or the sixth offer is visible. Buy if the gross advantage exceeds the displayed price. The ensuing fee-adjusted reward trains separate freight return estimates for the five earlier decisions at each benchmark price. Between grid points the learned policy linearly interpolates those early estimates and compares its purchase value with the exact price. Both policies skip ties at the survey gate.

Specific public-history cells borrow support from coarser groups with 48 pseudo-observations. Exact-history cells require an effective mass of at least 12. The eight prespecified profiles are equal tape weights and seven combinations that give fourfold group mass to hot drops, cold reversals, recovery analogues, or combinations thereof. Selection maximizes the smallest training-only margin across the three goals, then the mean margin and then fixed profile order. Seed 13 is always released. [Fitting code](fit.mjs)

The Bayesian planner uses its previous training-family prior, conditioning on signed offers, public bulletins and any purchased reading. It integrates possible readings and future offers and accounts for the announced tariff from wave one. Because the fee is sunk after acquisition, its later decision tree can be shared across prices. The five earlier stages are solved for the actual price, including intermediate whole-cent prices in the desk. [Inference and planner](../../docs/lib/tariff-policy.js)

## How to read the evidence

The primary comparisons weight each of seven prices equally. Fresh hot-ending interrupted drops and fresh cold-ending reversals each require a positive lower paired 95% bound for mean net credits over the Bayesian planner. On the exact original drop, require positive lower bounds versus the legacy stochastic planner, Booking and Survey, and lower bounds above −1 credit versus each of repriced Paid, Rally, Trust, Drift and Turns. Comparing the new agent to the Bayesian planner on the original drop is also reported.

Each freight tape uses the same signed offers, potential survey and bulletin noise at all seven prices. Percentile intervals use 2,000 bootstrap draws of complete seeds across all associated prices, families and endings. They quantify freight-draw uncertainty on fixed synthetic markets for the designated seed. Per-price, family and archived comparisons are descriptive. The separate acquisition test compares the released rule with forcing a buy or skip at its own gate over all positive-price fresh runs. Each forced policy uses the same opening decisions and continues with the information it has received. Net credits include the actual charge.

## Reproduce

Use Node.js 22 or later. The reference run used Node.js 24.18.0 on macOS arm64 CPU. The experiment uses the standard library.

```sh
git clone --branch tariff-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
npm run audit:tariff
node tools/reserve.mjs --suite tariff --policy rl --out tariff.json
node tools/reserve.mjs --verify tariff.json
```

The audit refits all five candidate sets and regenerates the release checkpoint, every priced score and the browser data. [Full machine-readable results](../../docs/data/tariff/results.json) · [Public agent guide](../../TARIFF.md)
