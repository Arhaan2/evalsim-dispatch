# Can the dispatcher tell when a survey makes it wait too long?

The new agent caught two costly waits on fresh cold reversals, both on the same freight tape at different prices. After paying for its surveys it earned **0.280 credits more per shift than the planner** and **0.000153 less than the same agent always skipping**. On fresh hot drops the earnings difference from the planner was +0.0008, with a 95% interval from −0.0726 to +0.0750. The original interrupted-drop gains passed all eleven retention checks. The joint target was missed. [Public study](https://arhaan2.github.io/evalsim-dispatch/waitcost.html) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html)

[Full shifts](#full-shifts) · [Paid and forced stops](#what-happened-when-the-survey-proposed-waiting) · [Matched positions](#matched-one-slot-positions) · [Original drop](#original-interrupted-drop-gains) · [Five fits](#five-training-runs) · [Methods](#how-the-guard-learns) · [Reproduce](#scope-and-reproduction)

## Full shifts

Each dispatcher takes all nine actions from the opening. The skip control uses the same blind freight policy. The stronger Bayesian planner makes independent booking and acquisition decisions. Differences are the release agent's mean net credits per shift minus the named control, with paired 95% intervals. The primary tests require lower bounds above zero on fresh cold reversals versus skipping and the planner, and on fresh hot drops versus the planner. Each row has four unseen schedules × 1,024 seeds × six positive prices (24,576 priced cases).

| Fresh market | Agent net | Difference vs skipping | Difference vs planner | Difference vs published Load Choice |
|---|---:|---:|---:|---:|
| Cold reversal | 48.208 | −0.000153 [−0.000250, −0.000073] | +0.280 [+0.150, +0.416] | +0.009 [−0.000376, +0.021] |
| Hot drop | 55.070 | −0.0026 [−0.0097, +0.0038] | +0.000777 [−0.073, +0.075] | −0.013 [−0.023, −0.004] |
| Hot reversal | 55.117 | −0.000153 [−0.000250, −0.000073] | −0.366 [−0.453, −0.275] | −0.007 [−0.016, +0.002] |
| Cold drop | 47.801 | +0.0352 [+0.0092, +0.0665] | −0.237 [−0.339, −0.137] | −0.000120 [−0.033, +0.034] |

Across all four fresh endings at positive prices, the release earned +0.0081 credits per shift versus skipping [+0.0018, +0.0154] and −0.0806 versus the planner [−0.1295, −0.0325]. Cold-ending drops contributed a +0.0352 gain over skipping. On the secondary free-price control across all endings, the difference from skipping was +0.0194 [+0.0035, +0.0365].

The previous Load Choice schedules were also replayed on 128 independent seeds. On those archived hot drops, the agent earned +0.2404 over the planner [+0.0962, +0.4073] and −0.0080 versus skipping [−0.0218, −0.0008]. The agent’s advantage over the planner on the earlier hot-drop patterns carried over to new draws. On the newly reserved hot-drop patterns its interval included zero. [Archived results](../../docs/data/waitcost/archive.json)

## What happened when the survey proposed waiting

The unguarded comparison uses the same acquisition gate and fee, with the earlier informed freight policy. The blanket rule takes every signed offer that the earlier informed policy would defer after its blind head would already book. Both comparisons isolate the action after purchase.

| Fresh market, paid purchases | Purchases | Eligible survey delays | Guard stopped | Stops helped / hurt / tied | Worthwhile stops missed | Difference vs unguarded per offered shift | Difference vs blanket stop per offered shift |
|---|---:|---:|---:|---|---:|---:|---:|
| Cold reversal | 50 | 2 | 2 | 2 / 0 / 0 | 0 | +0.0016 [0.0000, +0.0049] | 0.0000 [0.0000, 0.0000] |
| Hot drop | 265 | 16 | 8 | 0 / 8 / 0 | 0 | −0.0033 [−0.0077, 0.0000] | +0.0033 [0.0000, +0.0073] |

On cold reversals, the agent bought 50 readings on 25 distinct tapes. The earlier informed policy's two costly waits came on seed 19300881 at 5 and 10 cents. Both times the guard took wave six, saving 20 gross credits relative to waiting and earning the same freight as skipping. Across all cold purchases it gained 40 credits over leaving that earlier freight policy in charge, equaled the blanket stop rule, and paid 3.75 credits for zero additional freight over skipping.

On hot drops it bought 265 times on 99 tapes. It stopped eight useful waits across three tapes, costing 80 gross credits versus leaving the earlier informed freight policy in charge. It allowed eight other useful waits, saving 80 gross credits versus the blanket rule. Net across actual purchases was −63.85 credits versus skipping, comprising −20 in gross freight and 43.85 in fees. [Replay individual waits](https://arhaan2.github.io/evalsim-dispatch/waitcost.html#slot-example)

| Fresh market, forced purchases on all one-slot gates | Eligible one-slot cases | Deferrals available to stop | Guard stopped | Stops helped / hurt / tied | Worthwhile stops missed | Total gross payoff of guard vs unguarded |
|---|---:|---:|---:|---|---:|---:|
| Cold reversal | 13974 | 24 | 18 | 12 / 6 / 0 | 6 | +180.00 |
| Hot drop | 15582 | 282 | 228 | 18 / 210 / 0 | 6 | −1620.00 |

With every survey purchased at an eligible gate, the guard saved 12 of 18 harmful cold deferrals and also stopped six beneficial ones. On hot drops it saved 18 of 24 harmful deferrals and stopped 210 beneficial ones. Each fixed tape appears at six prices in this diagnostic. The frequency and size of those errors explain why reducing waits alone could not establish the hot-drop win. [Published per-case booking waves and ledgers](../../docs/data/waitcost/test.json)

## Matched one-slot positions

On each fee the previous Tariff policy plays the first five waves. Every eligible position is duplicated, with the same signed offers, one slot and posted fee, for the new policy, its forced-skip branch and the price-aware planner. Each comparison includes the complete common-prefix ledger.

| Fresh market, positive fees | Eligible positions | Seed clusters | Agent net | Versus skipping | Versus planner |
|---|---:|---:|---:|---:|---:|
| Cold reversal | 13974 | 771 | 46.986 | −0.000268 [−0.000442, −0.000116] | +0.094 [+0.019, +0.182] |
| Hot drop | 15582 | 843 | 56.342 | −0.0041 [−0.0161, +0.0063] | +0.214 [+0.141, +0.293] |

The positive hot-drop comparison once both agents inherit exactly one slot answers a different question from managing capacity from wave one. The full-shift hot-drop comparison remains inconclusive.

## Original interrupted-drop gains

Across 1,024 original-pattern seeds at all seven prices, the agent averaged 48.220 net credits per shift. Three lower bounds cleared zero and eight cleared the one-credit historical retention allowance. The current fee-aware planner led the new agent by 0.426 credits on the same runs. [Retention ledgers](../../docs/data/waitcost/retention.json)

| Reference | Mean net difference [paired 95% interval] | Required lower bound |
|---|---:|---:|
| Historical stochastic planner | +11.710 [+10.843, +12.563] | Above 0 |
| Booking | +1.236 [+0.882, +1.585] | Above 0 |
| Survey | +2.954 [+2.501, +3.451] | Above 0 |
| Load Choice | +0.010 [−0.015, +0.043] | Above −1 |
| Last Slot | +0.071 [−0.118, +0.251] | Above −1 |
| Tariff | −0.186 [−0.352, −0.042] | Above −1 |
| Paid | −0.415 [−0.601, −0.240] | Above −1 |
| Rally | −0.408 [−0.604, −0.235] | Above −1 |
| Trust | +0.302 [+0.083, +0.540] | Above −1 |
| Drift | −0.173 [−0.450, +0.070] | Above −1 |
| Turns | +0.246 [−0.214, +0.679] | Above −1 |
| Current fee-aware planner | −0.426 [−0.613, −0.255] | Secondary |

## Five training runs

All five trained agents face the identical fresh tapes. Each row gives mean differences in net credits per offered shift. The checkpoint with seed 13 was designated for release before training.

| Seed | Profile | Downside weight | Cold vs skip | Cold vs planner | Hot vs skip | Hot vs planner |
|---|---|---:|---:|---:|---:|---:|
| 13 (release) | cold-priority | 0.5 | −0.000153 | +0.2798 | −0.0026 | +0.000777 |
| 37 | cold-priority | 1 | −0.000018 | +0.2799 | +0.0018 | +0.0052 |
| 73 | cold-priority | 0.5 | −0.000153 | +0.2798 | −0.0053 | −0.0019 |
| 101 | cold-priority | 0.5 | 0.0000 | +0.2800 | −0.0024 | +0.000952 |
| 211 | cold-priority | 0.5 | −0.000024 | +0.2799 | −0.0024 | +0.000989 |

The mean cold-reversal difference from the planner was positive for every training seed. Four fits incurred a small loss versus skipping on cold reversals and one tied. The hot-drop point estimates versus the planner were close to zero across fits. [All five runs and intervals](../../docs/data/waitcost/results.json)

## How the guard learns

**Anchor and blind control.** The release holds the previous Load Choice freight checkpoint and Tariff opening fixed. Without a purchased reading it makes the same bookings as the previous checkpoint. With one slot and a reading at wave six or seven, it compares that checkpoint's informed call with its call on the same observed history with the reading masked. If the informed policy would pass an offer that the blind policy would take, the guard estimates the cost of deferring that particular load. Other freight calls use the published head unchanged. The simulator still offers two slots, eight waves, the same independent price-aware planner and a fresh six-sample reading before wave six. [Policy and public inputs](../../docs/lib/waitcost-policy.js)

**Paired returns.** The training logger passes freight and buys the reading to record all eight signed prices and actual survey samples. Freight offers are unaffected by acceptance, so the same tape supplies the payoff from taking the signed offer and the payoff from waiting. The first bank fits wave seven using the last signed load as the return to waiting. A separate bank fits wave six using what the frozen seventh-wave rule would actually book. Each eligible cell records three statistics in gross credits or probability units.

| Estimate | Sample target |
|---|---|
| Mean wait gain | Later booking payoff minus the signed offer now |
| Mean downside | Positive part of signed offer now minus later payoff, averaged over all tapes in that cell |
| Loss probability | Fraction of later bookings that pay strictly less than accepting now |

The agent books immediately when mean wait gain minus the candidate's downside weight times mean downside is at most zero. That weight is fixed for the released model. The loss probability is available for interpretation and is never an input from the future. With an unobserved fine-grained cell, the estimates borrow nearby training evidence, from the board and coarse first bulletin through groups that use survey bands, signed offer flags and public bulletins. Each level uses 24 pseudo-observations from the preceding level. The final cell distinguishes the five signed opening offers, first bulletin, reading, and sixth signed quote. The seventh decision also includes the updated bulletin and seventh signed quote. Stage and freight board are kept separate. The immediately preceding checkpoint has 171 opening-and-reading cells on the 9/18 board where the informed wave-six head would wait and the blind head would book. It has zero such cells at wave seven or on the other board. This structural count precedes the fresh evaluation. The test exercises a separate synthetic example where a seventh-wave guard is active. [Paired training computation](fit.mjs) · [Guard and information-boundary tests](../../test/waitcost-policy.test.mjs)

**Gate calibration.** On a third bank the trainer replays a one-slot continuation with the guard and a reading, and with the previous blind bookings, on identical signed freight. The difference in realized gross payoff trains a new purchase gate. Sparse samples pool with prefixes whose complete hypothetical buy and skip booking trees agree and then with prefixes sharing the first bulletin. A prefix where the informed and blind choices are identical for every possible later observation is assigned zero information value. The gate compares its estimate with the actual price. A tie goes to skipping, and it also skips with zero or two slots. Declining, buying at the posted price, and forcing each branch are all available in the published comparisons.

**Disjoint fitting and selection.** Each of five fits gets a separate 12,000-seed block beginning in the 19100000 range. It shuffles that block and takes four disjoint banks of 3,000, 3,000, 3,000 and 1,000 seeds. On 90 training families, the first three banks each cover 270,000 logged freight tapes. Six candidates cross penalties 0, 0.5, and 1 with balanced training weights or fourfold weight on cold reversals plus twofold weight on hot drops and recovery analogues. The selection set uses 17 separate training families and 105,000 priced runs. Selection maximizes the smallest mean margin on cold versus skipping, cold versus the planner, hot versus the planner, and original-pattern analogues versus the eleven historical controls with their respective margins. A tie uses the average of those four margins, then fixed candidate order. Features at inference contain only public observations; family labels enter the training mixture and scoring. The published checkpoint is seed 13, fixed before fitting. All five fits completed before any public split was scored. For the seed-13 winner, direct simulation and ledger verification independently reproduced the training-selection scores over every one of the 105,000 priced cases (525,000 policy rollouts). [Public pre-fit freeze](https://github.com/Arhaan2/evalsim-dispatch/tree/7014382951f66b70c3a7c91397c133f92ac2aaa7/training/waitcost)

## Scope and reproduction

The primary fresh groups each contain four schedules, 1,024 seeds and six positive prices. The free survey has its own control row. The same signed offers, bulletin noise and potential survey are shared across policies and prices on a tape. The fixed banks contain 896 validation, 114,688 fresh, 7,168 original-pattern retention and 14,336 previous-market archive cases. The reported 95% intervals use 2,000 paired percentile bootstrap draws, resampling whole seeds together with their families and prices (bootstrap seed 613). They quantify uncertainty over draws under these fixed synthetic schedules and checkpoint. The five-seed table reports variation due to fitting separately. One simulated credit contains 100 cents.

The reference run used Node.js 24.18.0 on macOS arm64 CPU. Use Node.js 22 or later to reproduce the tagged study without installing packages.

```sh
git clone --branch waitcost-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
npm run audit:waitcost
npm run audit:waitcost:ledgers
node tools/reserve.mjs --suite waitcost --split validation --policy ./examples/lastslot-agent.mjs --out my-report.json
node tools/reserve.mjs --verify my-report.json
```

The first audit refits all five agents and reproduces the reference banks and scorecards. The independent ledger audit reconstructs signed prices, readings, purchases, bookings and uncertainty from the seed manifests. A local agent can be supplied as a JavaScript module or an external process using JSON Lines. [Benchmark guide](../../WAITCOST.md) · [Independent audit](audit.mjs) · [Machine-readable results](../../docs/data/waitcost/results.json)
