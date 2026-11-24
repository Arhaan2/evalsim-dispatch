# Can a survey help the dispatcher choose a better load?

With one remaining slot, the new agent used its paid reading to change which load it booked on both fresh targets. On hot drops it beat the fee-aware planner by 0.204 credits per shift. Skipping the survey on every shift gave a statistically indistinguishable return. On cold reversals the planner led, and the surveys the agent bought reduced its net earnings. The original interrupted-drop retention test passed. [Play the study and inspect a booking](https://arhaan2.github.io/evalsim-dispatch/loadchoice.html) · [Research index](https://arhaan2.github.io/evalsim-dispatch/studies.html)

[Full shifts](#full-shifts) · [Which load changed](#which-load-changed) · [Original drop](#original-interrupted-drop) · [Five training runs](#five-training-runs) · [Learning method](#how-the-bookings-were-learned) · [Reproduce](#scope-and-reproduction)

## Full shifts

Eight previously unseen openings were each paired with a hot and a cold close. Each row below uses four fresh patterns × 1,024 seeds × six positive fees, or 24,576 priced cases. Both full dispatchers choose their own bookings from wave one. Forced skip runs the same trained dispatcher with the reading always hidden. “Previous agent” is the published Last Slot checkpoint, replayed under this study's new shifts. The table shows mean net credits per shift and paired 95% intervals for each difference.

| Fresh market | New agent | Difference vs forced skip | Difference vs planner | Difference vs previous agent |
|---|---:|---:|---:|---:|
| Cold-ending reversal | 48.513 | −0.0103 [−0.0234, +0.0004] | −0.052 [−0.098, −0.002] | −0.0005 [−0.0177, +0.0189] |
| Hot-ending drop | 55.430 | +0.0038 [−0.0138, +0.0201] | +0.204 [+0.112, +0.301] | +0.039 [−0.015, +0.099] |
| Hot-ending reversal | 55.294 | +0.0001 [−0.0007, +0.0016] | −0.157 [−0.198, −0.119] | −0.0067 [−0.0159, +0.0002] |
| Cold-ending drop | 43.039 | −0.0009 [−0.0235, +0.0215] | −0.284 [−0.407, −0.168] | −0.040 [−0.117, +0.031] |

The joint target required strictly positive lower bounds against both forced skip and the planner in each of the first two rows, plus original-drop retention. The hot-drop planner comparison and retention passed. Across all four fresh markets and six positive prices, the difference was −0.0018 [−0.0076, +0.0037] vs skipping, −0.072 [−0.105, −0.037] vs the planner and +0.266 [+0.251, +0.282] vs forcing a purchase with one slot. On the separate free-price control the agent bought 2,196 of 16,384 offers and earned +0.0015 [−0.0118, +0.0142] over skipping. On the 16 previous Last Slot schedules replayed on new seeds, the positive-fee difference vs the planner was −0.052 [−0.145, +0.031]. [Machine-readable results for all splits, prices and endings](../../docs/data/loadchoice/results.json)

## Which load changed

The controlled comparison first runs the frozen Tariff opener. Whenever it reaches the survey with exactly one slot, the specialist, its forced-skip control and the planner inherit identical freight history, balance, and potential reading. The specialist uses this same opener in full shifts, so these are also its own one-slot opportunities. Intervals in this table resample the seeds with an eligible position in each market.

| Matched positive-fee cases | Cases | Seeds | Difference vs forced skip | Difference vs planner |
|---|---:|---:|---:|---:|
| Cold-ending reversal | 15,384 | 910 | −0.0164 [−0.0365, −0.0006] | +0.032 [−0.010, +0.076] |
| Hot-ending drop | 14,208 | 939 | +0.0065 [−0.0224, +0.0365] | +0.454 [+0.294, +0.612] |

For each one-slot position, force a purchase and a skip on the same tape and record the final booked wave. First consider the cases where the agent actually bought. Gross difference is the change in signed load earnings before subtracting the fee.

| Actual purchases | Bought | Different booking wave | Higher / lower / equal pay among switches | Gross difference | Fees | Net difference |
|---|---:|---:|---:|---:|---:|---:|
| Cold-ending reversal | 89 | 21 | 6 / 15 / 0 | −240.00 | 12.60 | −252.60 |
| Hot-ending drop | 620 | 101 | 64 / 37 / 0 | +178.00 | 85.55 | +92.45 |

On cold reversals every paid switch replaced the blind policy's wave-six booking. Waiting until wave seven helped in six priced cases. Waiting until wave eight hurt in 15. Those switches came from seven distinct tapes, because the same freight runs at several prices. The 101 paid hot-drop switches came from 36 distinct tapes. Across both targets the agent sometimes bought a reading that left its booking unchanged. [Replay a gain and a loss on each target](https://arhaan2.github.io/evalsim-dispatch/loadchoice.html#slot-example)

Forcing purchase on **every** eligible cold reversal changed 60 of 15,384 bookings, with 24 earning more and 36 earning less. Gross freight fell by 504 credits across those cases. Forcing purchase on every eligible hot drop changed 420 of 14,208 bookings, with 264 earning more and 156 earning less. Gross freight rose by 708 credits before fees. The released checkpoint thus uses the reading to choose a different wave. Its full-shift hot-drop win over the planner includes its other freight decisions. [Per-case forced booking waves and reference earnings](../../docs/data/loadchoice/test.json)

## Original interrupted drop

The new agent averaged **47.630 net credits** across 1,024 draws of the original market and all seven prices. All three strict superiority checks passed, and all seven one-credit retention checks passed. The current fee-aware planner led by 0.292 credits per shift. [Retention bank](../../docs/data/loadchoice/retention.json)

| Original market reference | Agent minus reference [paired 95% interval] | Required lower bound |
|---|---:|---:|
| Historical stochastic planner | +10.798 [+9.896, +11.652] | Above 0 |
| Booking | +1.397 [+1.027, +1.782] | Above 0 |
| Survey | +2.524 [+2.036, +2.997] | Above 0 |
| Last Slot | +0.005 [−0.169, +0.192] | Above −1 |
| Tariff | −0.165 [−0.322, −0.022] | Above −1 |
| Paid | −0.280 [−0.456, −0.116] | Above −1 |
| Rally | −0.299 [−0.459, −0.147] | Above −1 |
| Trust | +0.026 [−0.146, +0.196] | Above −1 |
| Drift | +0.078 [−0.182, +0.327] | Above −1 |
| Turns | +0.058 [−0.413, +0.527] | Above −1 |
| Current fee-aware planner | −0.292 [−0.460, −0.139] | Descriptive |

## Five training runs

Seed 13 was fixed for deployment before training. Each fit below uses a separate block of simulator seeds and selects its model using training families alone. The balanced fits purchased more often on cold reversals and less often on hot drops. All five fits had negative point estimates vs the planner on cold reversals. Two beat the planner on hot drops, and the other three trailed it. No fit met all four fresh comparisons. The paired intervals for every run are in the results file.

| Training seed | Profile / pooling | Cold buys | Cold vs skip | Cold vs planner | Hot buys | Hot vs skip | Hot vs planner |
|---:|---|---:|---:|---:|---:|---:|---:|
| **13** | Targets-recovery / 96 | 89 | −0.0103 | −0.052 | 620 | +0.0038 | +0.204 |
| 37 | Targets-recovery / 96 | 88 | −0.0080 | −0.045 | 791 | +0.0016 | +0.229 |
| 73 | Balanced / 16 | 520 | −0.0057 | −0.091 | 261 | +0.0030 | −0.055 |
| 101 | Balanced / 96 | 446 | +0.0213 | −0.082 | 265 | +0.0094 | −0.054 |
| 211 | Balanced / 16 | 533 | −0.0180 | −0.065 | 260 | +0.0040 | −0.054 |

## How the bookings were learned

This is finite-horizon, model-free fitted Q-learning with simulated freight returns. The fixed Tariff opener handles the first five offers. If it leaves exactly one slot, the new policy can buy a six-sample count of current demand before it sees the sixth offer. If two slots remain, it skips and uses Tariff freight decisions until only one remains. When the specialist has one slot, it books the current signed offer if its price is at least the learned value of waiting. A remaining slot books the eighth and final offer. The fee is already sunk when the agent chooses a load. [Deployed decision function](../../docs/lib/loadchoice-policy.js)

Five training seeds each have a separate 12,000-seed block. Within each block, a seeded shuffle assigns distinct tapes to four stages. The first three stages use 90 fit families. These include older Booking markets and 48 new practice schedules covering both sustained and briefly misleading demand moves. The other 31 training families are held out of the value fits. Seventeen of those have a target or recovery ending and contribute to selection. The fresh tests use different schedules and seed ranges. [Market definitions](../../docs/lib/loadchoice.js)

| Stage per fit | Sample | Target in simulated credits |
|---|---|---|
| Wave-seven booking | 3,000 seeds × 90 families | If the agent passes, it collects the actual final load's signed price. |
| Wave-six booking | 3,000 new seeds × 90 families | If the agent passes, it earns the signed price selected by its fitted wave-seven rule. |
| Acquisition | 3,000 further seeds × 90 families | Replay both booking rules on each tape. Learn their paired gross earnings difference before seeing the reading. |
| Candidate selection | 1,000 further seeds × 17 target/recovery families, 105,000 priced cases | Score full-shift net margins on hot drops, cold reversals and recovery analogues. |

Each training tape logs the five-wave opening, both bulletins, each signed freight offer and a purchased count. The informed branch sees the count, including zero. The blind branch receives the same sequence of offers with the count hidden. They use the same examples, weights, feature hierarchy, and stopping objective. Replaying the independently drawn public price boards gives each board its own credit thresholds from those high/low outcomes. The trainer uses realized outcomes throughout. Inference uses only information already available at that decision. [Fitting code](fit.mjs)

Sparse states borrow returns from groups with similar public histories. The full table distinguishes the board, signs of all five opening offers, first bulletin, current signed offer, and purchased reading. Wave seven also includes the sixth signed offer and the updated bulletin. The broadest group shares whether the reading was available, and more specific groups use reading counts, freight signs and bulletin bands. Freight wait values are stored in thousandths of a credit. At an eligible gate, the agent buys when the predicted incremental gross return strictly exceeds the fee, measured in hundredths of a credit.

Six fixed candidates cross two pooling strengths (16 and 96 pseudo-observations) with three training weight profiles. Balanced gives every tape unit weight. Targets doubles weights for cold-ending reversals and hot-ending drops. Targets-recovery also doubles recovery analogues. Selection maximizes the smallest of five mean margins. Four margins compare the two fresh-target analogues to forced skip and the planner. The fifth is the smallest recovery margin across ten historic controls using the original one-credit retention allowance where applicable. Ties use the average margin, then fixed candidate order. All five candidate sets finished selection before any public split was scored. Seed 13 was designated for publication in advance. [Frozen study definition](https://github.com/Arhaan2/evalsim-dispatch/tree/b5d2012f577e2b239e55dbecca64e7bd2f6838c9/training/loadchoice)

## Scope and reproduction

The fixed banks contain 896 validation cases, 114,688 fresh test cases, 7,168 retention cases, and 14,336 historical archive cases. The seven posted fees are 0, 5, 10, 25, 50, 75, and 100 cents. One simulated credit is 100 cents. The primary fresh tests use the six positive prices. Intervals are paired percentile bootstraps across whole simulator seeds with every sibling family and price together (2,000 draws, bootstrap seed 613). The estimates describe variation over shifts under the published synthetic market schedules and checkpoint. The separate training-seed table shows sensitivity to refitting. [Scorer and load accounting](evaluate.mjs) · [Public benchmark implementation](../../docs/lib/loadchoice-benchmark.js)

The reference run used Node.js 24.18.0 on macOS arm64 CPU. The tagged code runs on Node.js 22 or later without installing packages.

```sh
git clone --branch loadchoice-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
npm run audit:loadchoice
npm run audit:loadchoice:ledgers
node tools/reserve.mjs --suite loadchoice --split validation --policy ./examples/loadchoice-agent.mjs --out validation.json
node tools/reserve.mjs --verify validation.json
```

The audit refits the five agents and checks the weights, train-only candidate selections, full reference banks, matched branches and public desk data against the saved release. The separate ledger audit regenerates the freight, the survey and the paired comparisons from the simulator seeds. The benchmark guide includes test and retention commands, JavaScript and Python starters, and browser verification. [Reproduction driver](run.mjs) · [Independent ledger audit](audit.mjs) · [Run your own agent](../../LOADCHOICE.md) · [Public study directory](https://arhaan2.github.io/evalsim-dispatch/studies.html)
