# What is a fresh freight survey worth?

A dispatcher sees five signed offers, its remaining truck slots and a delayed public bulletin. Before the sixth price arrives it can spend one net credit on a fresh survey. The survey counts high responses across six separate samples of the current wave-six high-offer probability. The agent then sees the signed price and, if it paid, the reading. The normal delayed bulletin still arrives at wave seven. Earnings equal booked freight contributions less the survey charge.

The protocol, schedule definitions, training candidates, release seed, fee and outcome tests were public before training. [Frozen protocol](https://github.com/Arhaan2/evalsim-dispatch/tree/54f7e9eabca45382c1e8d39983c0a59258a76438/training/paid)

## Results after fees

The designated learner and the survey-aware planner each declined all 26,112 paid surveys across five public banks. The learner earned 49.97 net credits per fresh shift, compared with 50.02 for the survey-aware planner. Across the 8,192 fresh shifts the mean difference was −0.05 (paired 95% interval −0.09 to −0.01). Neither dispatcher used the reading at the official tariff, so differences between them on these shifts arose from their freight bookings.

| Market | Shifts | Agent | Survey-aware planner | Difference (paired 95%) | Difference vs legacy planner (paired 95%) |
|---|---:|---:|---:|---|---|
| All fresh shifts | 8,192 | 49.97 | 50.02 | −0.05 (−0.09 to −0.01) | +0.95 (+0.78 to +1.12) |
| Fresh hot-ending drops | 2,048 | 54.42 | 54.40 | +0.02 (−0.02 to +0.06) | −1.44 (−1.68 to −1.19) |
| Fresh cold-ending reversals | 2,048 | 44.35 | 44.55 | −0.21 (−0.33 to −0.09) | +0.20 (−0.09 to +0.49) |
| Fresh cold-ending drops | 2,048 | 45.05 | 45.20 | −0.15 (−0.25 to −0.05) | +3.92 (+3.42 to +4.43) |
| Fresh hot-ending reversals | 2,048 | 56.06 | 55.93 | +0.13 (+0.08 to +0.18) | +1.13 (+0.85 to +1.42) |
| Original interrupted drop | 1,024 | 48.31 | 48.33 | −0.01 (−0.08 to +0.05) | +12.07 (+11.23 to +12.92) |
| Booking cold reversals, new seeds | 2,048 | 43.80 | 43.85 | −0.05 (−0.12 to +0.03) | −0.45 (−0.74 to −0.18) |
| Survey cold reversals, new seeds | 2,048 | 45.03 | 45.32 | −0.30 (−0.44 to −0.16) | −0.38 (−0.79 to +0.01) |

**Fresh hot drops were inconclusive.** The agent led by 0.02 credits against the survey-aware planner and fell 1.44 behind the legacy planner. **Fresh cold reversals favored the survey-aware planner** by 0.21 credits. Neither archive established a cold-reversal win on its new seed bank. The original Survey archive also missed the one-credit preservation margins against both Booking and Survey.

**The historical original-drop gains were recovered.** The agent improved on Booking and Survey, beat the legacy planner by 12.07 credits, and met the prespecified one-credit retention margin against all four earlier agents. The stricter composite recovery test also required beating the new survey-aware planner. On this comparison the difference was −0.01, with an interval spanning zero.

| Reference | Agent minus reference (paired 95%) |
|---|---|
| Survey-aware planner | −0.01 (−0.08 to +0.05) |
| Legacy stochastic planner | +12.07 (+11.23 to +12.92) |
| Booking | +1.57 (+1.19 to +1.96) |
| Survey | +3.00 (+2.52 to +3.51) |
| Rally | +0.04 (−0.04 to +0.14) |
| Trust | +0.27 (+0.06 to +0.47) |
| Drift | +0.39 (+0.16 to +0.61) |
| Turns | +0.37 (−0.11 to +0.84) |

## When did buying pay?

Across the fresh gates reached with capacity left, the highest estimated gross value of the reading was 0.52 credits for the learner and 0.12 for the planner. At one credit the learned gate matched never buying. It beat always buying by 1.04 credits per fresh shift (paired 95% interval +0.99 to +1.09). With the survey forced, it changed 185 of the 8,192 freight booking sequences. Freight earnings alone fell by 333 credits in total before the additional 8,192 credits in fees. The planner changed 61 sequences and lost 1.02 per fresh shift when forced to buy. At zero price the learned policy bought on 836 fresh shifts, and the planner bought on 1,197. The free-signal learner averaged 49.96, against 49.97 at the official price. There is no measured benefit from selective paid purchasing for this released policy.

The two staggered-lift endings for seed 15300271 reach an identical public purchase decision. Even the potential reading is identical at 2/6. The agent skips and earns 52 on both tapes. Forcing the purchase makes it pass on the sixth offer in both. After the fee it earns 31 on the cold ending (−21 versus skipping) and 61 on the hot ending (+9). These individual outcomes became known after the decision. [Replay the survey tradeoff](https://arhaan2.github.io/evalsim-dispatch/paid.html#survey-value)

All five fits selected the equal-weight training profile. All five trailed the planner on fresh cold reversals. Their fresh hot-drop estimates ranged from −0.09 to +0.07 relative to that planner. Four fitted policies declined every paid survey on the fresh test, and seed 101 bought on 18 shifts. The release seed stayed fixed at 13. [Raw per-fit results and decisions](../../docs/data/paid/results.json)

## Training and planning

The learned dispatcher uses fitted finite-horizon reinforcement learning. On training tapes it can evaluate both booking actions at each remaining capacity. Working back from the eighth offer, it fits the freight returns with one or two slots, both with the six-sample reading visible and with it masked. A second training bank supplies identical buy and skip branches at each purchase window under that fitted continuation. The four fitted returns describe buying and skipping with one and two open slots. To choose, subtract the tariff from the buy estimate and compare it with skip. The resulting fee-adjusted return trains the first five booking decisions. A purchase can pay off only through a change in the freight ultimately accepted.

The lookup tables use public price supports, high/low offer history, available bulletins, capacity and the purchased reading. Estimates on sparse histories shrink toward coarser histories with 48 pseudo-observations. The purchase estimator sees the available history before wave six. At deployment both policies receive ordinary operator observations and are charged for the same reading.

The comparator is a Bayesian planner with a uniform prior on the 42 fitting families and four endpoint combinations. It conditions on signed prices, available delayed bulletins and any purchased survey. It integrates all seven possible fresh readings and optimizes the remaining bookings and purchase before seeing their outcomes. It includes a 1% uniform component in delayed-bulletin likelihoods to give unseen bulletin combinations a defined posterior. The training paths are a modeling assumption. The fresh schedules can depart from them. The legacy stochastic planner, which takes posted odds at face value, remains a separate historical reference. [Planner and deployed policies](../../docs/lib/paid-policy.js)

The five independent fits use disjoint 12,000-seed blocks. Within each block, 2,000 seeds across 42 training families supply 84,000 late freight-training tapes. Another 2,000 seeds across those families supply 84,000 acquisition and early-booking tapes. A third set of 1,000 seeds across 15 separate training families supplies 15,000 selection shifts. At both fitting stages, paired branches share all freight and potential survey draws.

The ten candidate weightings include equal mass per training tape and a grid of hot-drop and original-recovery proxy group masses. The grid crosses 1, 4 and 12 for each group, giving mass 4 to cold reversals and 1 to the remaining paired endings together. Selection maximizes the smallest observed margin over training-only versions of the three goals. Mean margin and then fixed candidate order break ties. The designated release uses training seed 13. Four additional fits use 37, 73, 101 and 211. [Fitting code](fit.mjs)

## Reading the comparisons

On fresh hot drops, require a positive lower paired 95% bound versus the survey-aware planner. On cold reversals, require the same planner win and lower bounds above −1 credit versus both Booking and Survey. Apply each cold test separately to the unseen schedules and the two historical banks on new draws. For original-drop recovery, require positive lower bounds versus the new planner, legacy stochastic planner, Booking and Survey. Lower bounds must also exceed −1 against each of Rally, Trust, Drift and Turns.

The intervals resample whole seeds 2,000 times, retaining the shared draws between policies, families and twin endings. They describe freight-draw uncertainty on fixed synthetic schedules for the prespecified checkpoint. On the new tests, at wave six one pair in each stratum is aligned with its final ending and one pair temporarily moves the other way. This is a generalization test with four openings. [Market definitions](../../docs/lib/paid.js)

At the official price, forced-buy and forced-skip controls follow their optional policy until the survey window, force the indicated decision, then follow the same freight policy with the information available. The free controls change the displayed tariff to zero. The planner replans the opening for that tariff. The learned policy uses its one-credit early freight tables and reprices its acquisition decision. A second diagnostic independently forks the actual window reached by each optional policy. These replays separate what a purchase earned on shifts where it bought from what it would have earned on shifts where it declined. The realized difference includes the tariff.

## Reproduction

Use Node.js 22 or later. The reference CPU run used Node.js 24.18.0 on macOS arm64. Training, inference, local benchmarks and report verification use the standard library.

```sh
git clone --branch paid-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
npm run audit:paid
node tools/reserve.mjs --suite paid --policy rl --out paid.json
node tools/reserve.mjs --verify paid.json
```

The audit refits all five candidate sets and regenerates every score, purchase diagnostic and comparison across five public splits. [Benchmark your own agent](../../PAID.md) · [Checkpoint and results](../../docs/data/paid/results.json)
