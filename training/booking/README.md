# Learning when to book before the final survey

A dispatcher can take two of eight freight offers. Accepting an offer locks in its signed net price and uses one truck slot. Waiting leaves that slot available at the next wave. This experiment learns those choices through wave six and hands the actual remaining capacity to the published Survey agent for waves seven and eight. The protocol, market definitions, selection rule, release seed and evaluator were public before the first fit. [Frozen experiment](https://github.com/Arhaan2/evalsim-dispatch/tree/60094e4e1227a957b44b66588f396e80f4cf84d5/training/booking)

## Did the new policy meet the targets?

Each difference is the released agent’s mean net credits per shift minus the named reference. Intervals use 2,000 paired bootstrap draws of whole seeds, keeping policies, markets and twin endings together. They describe uncertainty over freight draws on these fixed schedules. Generalization to other schedules and variation across training runs are separate questions.

| Market | Shifts | Agent | Planner | Difference vs planner (95%) | Difference vs Survey (95%) |
|---|---:|---:|---:|---|---|
| All fresh shifts | 8,192 | 50.46 | 49.74 | +0.72 (+0.54 to +0.90) | +0.04 (−0.05 to +0.12) |
| Fresh hot-ending drops | 2,048 | 55.62 | 57.01 | −1.39 (−1.70 to −1.10) | −0.40 (−0.55 to −0.26) |
| Fresh cold-ending reversals | 2,048 | 44.73 | 44.47 | +0.26 (+0.02 to +0.50) | −0.15 (−0.34 to +0.03) |
| Fresh cold-ending drops | 2,048 | 46.92 | 43.49 | +3.44 (+2.96 to +3.92) | +0.36 (+0.14 to +0.59) |
| Fresh hot-ending reversals | 2,048 | 54.58 | 53.99 | +0.59 (+0.37 to +0.81) | +0.35 (+0.21 to +0.49) |
| Original interrupted drop | 1,024 | 46.62 | 36.60 | +10.02 (+9.19 to +10.87) | +1.50 (+1.14 to +1.91) |
| Earlier cold-ending reversals, new seeds | 2,048 | 45.97 | 45.71 | +0.26 (−0.06 to +0.58) | −0.15 (−0.43 to +0.10) |

**Fresh hot-ending drops missed.** The planner led on both new openings. Its advantage averaged 1.14 credits on shallow-slide and 1.64 on second-surge. Each of the five independently fitted agents trailed it on these drops.

**Cold reversals passed on fresh openings.** The positive planner difference and the lower bound within one credit of Survey met both requirements. On the earlier Survey schedules the planner interval included zero, so the repeat missed the requirement to establish a win on both banks.

**Original interrupted-drop recovery was partial.** The agent outscored both Survey and the planner. Full recovery also required a lower paired bound above −1 credit against each of four historical references. All four comparisons missed that threshold.

| Earlier agent | Original-drop difference (paired 95%) |
|---|---|
| Rally | −2.04 (−2.46 to −1.63) |
| Trust | −1.34 (−1.79 to −0.87) |
| Drift | −1.70 (−2.17 to −1.22) |
| Turns | −1.33 (−1.95 to −0.75) |

The joint target therefore missed. Per-family and per-seed scores, comparisons, candidate profiles and the released checkpoint are available in the artifact. [Machine-readable results](../../docs/data/booking/results.json) · [Public scorecard](https://arhaan2.github.io/evalsim-dispatch/booking.html#benchmark)

## How the agent learned

For each training shift, the simulator generates a signed offer at every wave regardless of past bookings. This lets us evaluate both feasible actions on the same tape for either remaining capacity. Start at wave seven with the frozen Survey policy. Working backwards through the six earlier waves, fit the expected future credits with one and two free slots. A booking is worth the known signed price plus the fitted continuation with one fewer slot. Waiting is worth the fitted continuation with all current slots. The larger estimate selects the action, with ties going to booking. Realized simulator returns under this choice become the training targets for the previous wave. This is fitted finite-horizon reinforcement learning with full counterfactual feedback from the simulator. Real individual shifts reveal only one ending to a dispatcher.

The lookup uses the stage, price supports, signed high/low history and the available wave-four bulletin. More specific history estimates shrink toward coarser groups with 48 pseudo-observations. The runner withholds market identity, ending, seed and future offers from deployment. Training uses market labels to weight tapes. The agent receives the same public observation as an outside policy.

Each independent fit uses 2,000 seeds across 42 training families (84,000 shifts, 1,008,000 capacity-specific early decisions with paired action targets). Candidate selection uses another 1,000 seeds across 15 separate families (15,000 shifts). Six of the fitting families and three of the selection families resemble the interrupted drop. The exact original generator appears only in the retention evaluation. Fits use disjoint 12,000-seed blocks.

The grid includes an equal-weight control and 15 reward-return fits that vary the training mass on hot drops and recovery analogues. Selection maximizes the smallest margin across training-only analogues of the three goals, then the mean margin, then uses fixed candidate order. Seed 13 was designated for release before training. It chose group masses of 2 for hot drops, 4 for cold reversals, 1 for recovery and 1 for the other paired endings together. Seeds 37, 73, 101 and 211 each chose 8, 4, 4 and 1. Even on the selection markets, every winning candidate had a negative hot-drop margin.

The equal-weight fit earned 2.01 more credits than the released fit on the original drop. Reweighting improved the released fit by 0.28 on fresh hot drops and 0.63 on fresh cold reversals, with an overall fresh cost of 0.16. These comparisons use the same seed, training draws and Survey continuation. [Learner](fit.mjs) · [Frozen selection and thresholds](protocol.mjs)

## What a sixth-wave booking bought

Two shifts present **identical public information** at wave six. One slot remains, 24 credits are banked and the current offer pays 24. The posted high-offer chance is 80%. The agent estimates that waiting is worth 22.11 and books on both shifts, finishing with 48. Both Survey and the planner wait. On original-drop seed 14400026 they finish with 28. On shallow-slide-hot seed 14300260 they finish with 58. The decision trades an immediate price for an uncertain closing offer. [Replay the decisions](https://arhaan2.github.io/evalsim-dispatch/booking.html#early-decisions)

Across all original drops, the new agent booked 128 times on wave six where Survey would have waited, earning 1,654 extra credits across those decisions. On fresh hot drops it made that choice 111 times and lost 864 credits. Against the planner with the same Survey continuation, 324 extra bookings at wave three and 214 at wave six cost 1,058 and 1,166 credits respectively on fresh hot drops. On fresh cold reversals, 84 extra wave-three bookings gained 559 credits.

To attribute the differences, the evaluator replays the baseline’s public prefix, varies one early action, then follows the learned policy on both copies of the same freight tape. For each tape, the six incremental differences sum exactly to the full policy score gap. Across all 17,408 scored shifts, the full planner and full Rally earned identical per-shift scores to their respective controls that hand off to Survey at wave seven. [Decision audit](evaluate.mjs)

## Reproduce the release

Use Node.js 22 or later. The reference training run used Node.js 24.18.0 on macOS arm64 CPU. The benchmark, training and verifier have no npm dependencies.

```sh
git clone --branch booking-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
npm run audit:booking
node tools/reserve.mjs --suite booking --split test --policy rl --out booking.json
node tools/reserve.mjs --verify booking.json
```

The audit refits all five candidate sets, replays all 17,408 scored shifts and checks the stored output. The public benchmark also includes 512 development shifts and JavaScript and Python starters. [Agent and manifest guide](../../BOOKING.md)
