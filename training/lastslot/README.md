# Learning what a survey is worth with one booking left

The released DISPATCH agent earned more net credits than the fee-aware Bayesian planner on fresh hot-ending drops and cold-ending reversals. The experiment also asked whether buying the survey improved on the **same agent always skipping**. The hot-drop estimate was small and its interval crossed zero. On cold reversals the survey made no difference to gross freight earnings on any eligible priced run. The release retained the original interrupted-drop gains under the prespecified comparisons. [Frozen protocol and source](https://github.com/Arhaan2/evalsim-dispatch/tree/cbbdae4/training/lastslot) · [Machine-readable results](../../docs/data/lastslot/results.json)

## Full-shift results

Each dispatcher starts with two slots and eight offers. Before the sixth offer it can pay the announced price for six samples of current demand. Net credits are booked freight earnings less the survey fee. The independent planner chooses its own bookings and survey purchases from wave one. The forced-skip specialist uses the identical opening and late freight policy as the released specialist and receives no fresh reading.

The primary comparisons use six equally weighted positive prices of 0.05, 0.10, 0.25, 0.50, 0.75 and 1.00 credits. Each ending in the table covers four fresh patterns × 1,024 seeds × six prices, or 24,576 full shifts. Differences are the optional specialist's mean net credits per shift minus the named reference, with paired 95% intervals.

| Fresh ending | Specialist net | Difference vs forced skip | Difference vs planner |
|---|---:|---:|---:|
| Hot-ending drop | 56.203 | +0.0175 [−0.0030, +0.0365] | +0.332 [+0.257, +0.406] |
| Cold-ending reversal | 46.526 | −0.000006 [−0.000024, 0] | +0.129 [+0.064, +0.201] |
| Cold-ending drop | 43.275 | −0.0059 [−0.0315, +0.0227] | −0.204 [−0.286, −0.127] |
| Hot-ending reversal | 55.541 | +0.0006 [0, +0.0026] | −0.221 [−0.270, −0.173] |

The joint target required all four lower bounds in the first two rows to exceed zero and the original-drop retention criteria to pass. Only the planner comparisons and retention passed. Across all 98,304 fresh positive-price runs the specialist's advantage was +0.0031 [−0.0033, +0.0099] over forced skip, +0.0088 [−0.0166, +0.0342] over the planner and +0.2718 [+0.2603, +0.2826] over forcing a purchase with one slot. On the separate free-price control the agent bought on 580 of 16,384 runs and earned +0.0115 [−0.0011, +0.0243] over skipping. On the eight earlier Tariff schedules with new draws, the positive-price difference from the planner was −0.174 [−0.369, +0.014].

## What the purchases changed

A second comparison gives all three policies the same position at the survey desk. The previous Tariff policy plays the first five waves at each posted fee. Whenever it has exactly one slot left, the benchmark clones the signed offers, remaining capacity, balance and unrevealed survey for each policy. Every qualifying run counts. Release seed 13 selected the Tariff opening, so these counts also describe its own one-slot opportunities.

| Common starting position at positive prices | Eligible runs | Specialist purchases | Difference vs forced skip | Difference vs planner |
|---|---:|---:|---:|---:|
| Hot-ending drop | 15,024 | 477 | +0.0287 [−0.0043, +0.0599] | +0.578 [+0.461, +0.695] |
| Cold-ending reversal | 16,230 | 2 | −0.000009 [−0.000028, 0] | +0.167 [+0.094, +0.253] |

On hot drops, the 477 purchases added **514.00 gross credits** relative to skipping and cost **83.35 credits**, a net gain of **430.65** across the 24,576 positive-price shifts. On cold reversals, forcing a purchase on **every** eligible run produced exactly the same gross earnings as forcing a skip on each of those 16,230 runs. The optional specialist paid 0.15 credits in total. With the checkpoint's freight policy fixed, changing only the purchase threshold could at best have saved that fee on this sample. The controlled comparisons keep the relatively rare purchases in proportion to all opportunities. [Published action controls and cent ledgers](../../docs/data/lastslot/test.json)

## Original interrupted drop

The released specialist averaged **48.117 net credits** over 1,024 fresh draws of the original generator, each run at all seven prices. Retention required positive lower bounds versus the legacy stochastic planner, Booking and Survey and lower bounds above −1 credit versus each of the six historical agents listed below. The comparison to the current fee-aware planner measures its independent performance on the original market.

| Reference | Specialist minus reference, net credits per shift [paired 95%] |
|---|---:|
| Legacy stochastic planner | +11.271 [+10.447, +12.104] |
| Booking | +1.195 [+0.835, +1.567] |
| Survey | +2.820 [+2.327, +3.315] |
| Previous Tariff | −0.135 [−0.248, −0.042] |
| Paid | −0.260 [−0.416, −0.128] |
| Rally | −0.266 [−0.410, −0.145] |
| Trust | +0.412 [+0.169, +0.664] |
| Drift | −0.089 [−0.357, +0.156] |
| Turns | +0.354 [−0.130, +0.845] |
| Current fee-aware Bayesian planner | −0.282 [−0.443, −0.149] |

## How the specialist learned

This is finite-horizon, model-based offline reinforcement learning. The specialist learns one-slot freight continuation values and the incremental return to acquiring information. Two frozen opening policies are eligible, the previous Tariff learner and the Bayesian planner. The selected opening handles the first five freight offers and subsequent freight decisions while two slots remain. The specialist declines surveys with zero or two slots left. Once a single slot remains after the gate, it uses its own freight policy for the remaining bookings. The comparison planner can purchase with either one or two slots and plans from the beginning using its own training-family prior. [Learned policy](../../docs/lib/lastslot-policy.js) · [Planner](../../docs/lib/tariff-policy.js)

Each of five fits draws from its own 12,000-seed block inside the 60,000-seed training split. A deterministic shuffle selects three disjoint banks. Each tape in the first two banks supplies its public opening history and a hidden simulated suffix for training. Only public observations enter the deployed agent.

| Stage per fit | Data | Learning target |
|---|---|---|
| Freight continuation | 2,000 seeds × 42 training families, 84,000 tapes | The expected return from holding the last slot open at wave six or seven |
| Survey calibration | Another 2,000 seeds × the same 42 families, 84,000 tapes | Paired gross return from buying minus skipping, conditional on public history |
| Selection | 1,000 further seeds × 15 separate training families × seven prices, 105,000 priced runs | Full-shift net credits on actual realized freight and readings |

**Freight decisions.** For each public board, first delayed bulletin and signed five-offer history, fitting estimates a distribution over future outcomes from the weighted training tapes. Sparse histories borrow 48 pseudo-observations from a group sharing the bulletin and signs of waves two and three. That group likewise borrows 48 from the whole board. Given each simulated suffix, the trainer integrates the seven possible fresh readings, wave-six and wave-seven offer signs, the wave-seven bulletin noise and the expected final signed offer. Backward optimal stopping supplies wait values at waves seven and six. The deployed decision accepts when the signed offer equals or exceeds its wait value, rounded to a thousandth of a credit.

**Purchase decisions.** With freight thresholds fixed, the calibration bank evaluates informed and blind freight returns on the *same* future outcomes. It subtracts the two gross returns within each branch and averages the paired differences. A one-slot agent buys when that calibrated gross advantage exceeds the posted fee, before it sees the reading or sixth offer. It skips price ties. All whole-cent prices from zero through one credit are supported. [Trainer](fit.mjs)

**Selection.** Each fit compares eight candidates. Four sets of training-tape multipliers cross the two opening policies. All tapes start at weight one. The other three profiles give fourfold weight to hot drops and cold reversals together, to those two plus recovery analogues, or to recovery analogues alone. Selection maximizes the smallest of five mean margins on the selection bank. Four are the hot and cold positive-price differences versus forced skip and the independent planner. The fifth is the smallest recovery margin against the nine historical controls, using all prices and the same one-credit allowance as the retention test. Ties break on the mean of these five margins, then fixed candidate order.

**Replication.** Training seeds 13, 37, 73, 101 and 211 all selected fourfold weighting for all three target groups. Seeds 13, 37 and 101 selected the Tariff opening. Seeds 73 and 211 selected the planner opening. Seed **13** was fixed for release before fitting. Across the five fits, hot-drop purchases on the 24,576 fresh priced runs ranged from 358 to 495 and cold-reversal purchases from 0 to 7. The joint test uses the designated release checkpoint.

## Evaluation scope

The four public banks contain 896 validation runs, 114,688 fresh test runs, 7,168 original-drop retention runs and 7,168 archive runs. The test bank has eight pairs of fresh schedules. Each pair shares five-wave opening demand and has both a hot and a cold finish. Within each target, half the schedules have a wave-six signal aligned with the eventual close, and half have a wave-six move in the opposite direction. The same underlying freight, bulletin noise and potential reading are reused across prices and agents on each tape.

Intervals use 2,000 paired percentile-bootstrap draws, starting with seed 613. Each draw resamples entire simulator seeds with their associated prices, sibling endings and market families. The intervals describe variation across freight draws for this fixed checkpoint and these synthetic schedules. Training-seed variability is reported separately. Each shift uses simulated credits. [Shift definitions](../../docs/lib/lastslot.js) · [Scoring and comparison code](evaluate.mjs)

## Reproduce or benchmark an agent

Use Node.js 22 or later. The reference run used Node.js 24.18.0 on macOS arm64 CPU and the Node standard library. From a terminal, run the following commands.

```sh
git clone --branch lastslot-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
npm run audit:lastslot
node tools/reserve.mjs --suite lastslot --split test --policy rl --out specialist.json
node tools/reserve.mjs --verify specialist.json
```

The audit refits every training seed, reruns the selection rule and compares the regenerated checkpoint, reference ledgers, matched comparisons and browser data against the published files. To evaluate another dispatcher, replace `rl` with a local module such as `./examples/lastslot-agent.mjs`. The guide also covers subprocess agents, report verification and the free browser desk. [Public benchmark guide](../../LASTSLOT.md) · [Release data](../../docs/data/lastslot/)
