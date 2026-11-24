# Benchmark the load you choose after a survey

With one truck slot left and three signed offers still to come, a six-sample reading of current demand is valuable if it helps you book a better load. The fee is posted at the opening and applies the moment you buy. Try the decision yourself, inspect the paired booking branches, or run your policy on the same shifts. [Study and playable desk](https://arhaan2.github.io/evalsim-dispatch/loadchoice.html) · [Browse the research](https://arhaan2.github.io/evalsim-dispatch/studies.html)

The trained dispatcher changed bookings on 21 paid cold-reversal runs and 101 paid hot-drop runs. It beat the independent planner on hot drops, fell behind it on cold reversals and kept the original interrupted-drop gains. Neither target established a net advantage over the same learner always skipping. [Read the paired results](training/loadchoice/)

## Run a dispatcher

Node.js 22 or later runs the JavaScript starter offline. The release includes the simulator, trained policies, reference scores, verifier and all synthetic scenarios under the MIT license.

```sh
git clone --branch loadchoice-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite loadchoice --split validation --policy ./examples/lastslot-agent.mjs
node tools/reserve.mjs --suite loadchoice --split test --policy ./examples/lastslot-agent.mjs --out my-report.json
node tools/reserve.mjs --verify my-report.json
```

Upload the report to replay the recorded actions and compare your dispatcher with the fee-aware planner and the released learner. Your file stays in the browser. [Verify your report](https://arhaan2.github.io/evalsim-dispatch/loadchoice.html#own-agent) · [JavaScript starter](examples/lastslot-agent.mjs) · [Python starter](examples/lastslot_agent.py)

```sh
node tools/reserve.mjs --suite loadchoice --split test --out python-report.json -- python3 examples/lastslot_agent.py
node tools/reserve.mjs --suite loadchoice --split retention --policy ./examples/lastslot-agent.mjs --out original.json
node tools/reserve.mjs --suite loadchoice --split archive --policy ./examples/lastslot-agent.mjs --out previous-markets.json
node tools/reserve.mjs --suite loadchoice --split test --manifest > manifest.json
```

### Policy interface

- Export a default JavaScript function `(observation, calls) => action`, or a `createPolicy()` factory to reset private memory for each shift. Subprocess agents read a JSON Lines request with the observation and allowed calls, then write one flushed response such as `{"action":"buy"}`.
- You begin with two slots. On each of eight freight offers, `accept` books a signed load and consumes a slot. You may always `pass`. You see the current price, public quotes and observed history. Two delayed bulletins arrive during the shift.
- After wave five, `phase === "survey"`. Choosing `buy` pays the posted `priceCents` and reveals `reading`, an integer from 0 through 6. Choosing `skip` leaves the reading null. Wave six's signed offer is revealed after that decision. Your agent and the independent planner can buy at any capacity. The learned study policy buys only with exactly one slot.
- Every report verifies the signed bookings, survey decision, actual reading and fee. Earnings in `netCents` equal `grossCents - feeCents`. A credit contains 100 cents. For custom tariffs, import `runLoadchoiceCase` from `evalsim-dispatch/loadchoice` and call it with a config such as `{seed: 42, family: "late-crest-cold", priceCents: 37}` and your decision function.

## Choose a split

| Split | Markets | Seeds | Distinct freight tapes | Priced runs |
|---|---|---|---:|---:|
| validation | Two development openings, each with two endings | 18200000–18200031 | 128 | 896 |
| test | Eight fresh openings, each with two endings | 18300000–18301023 | 16,384 | 114,688 |
| retention | Exact original interrupted drop | 18400000–18401023 | 1,024 | 7,168 |
| archive | The previous Last Slot test schedules on fresh draws | 18500000–18500127 | 2,048 | 14,336 |

Development, fitting, test, retention and archive seeds are disjoint. Freeze your own policy after validation. Each fixed tape runs at 0, 5, 10, 25, 50, 75 and 100 cents. The two primary targets each have four schedules, 1,024 seeds and six positive prices. All six prices share their freight and potential reading. Each pair of endings shares its first five offers.

## Interpret a score

| CLI policies | What the comparison measures |
|---|---|
| `rl`, `rlNever`, `rlAlways` | Same learned bookings and opening. The survey decision is optional, forced skip, or forced buy at an eligible one-slot gate. |
| `planner` | Independent Bayesian planner managing both its bookings and the priced survey. |
| `lastslot`, `tariff`, `paid` | The three previous survey-acquisition checkpoints evaluated at the posted fee. |
| `stochastic`, `booking`, `survey`, `rally`, `trust`, `drift`, `turns` | Earlier controls used to assess retention of the original interrupted-drop gains. |

Full-shift scores measure net credits from wave one. A second comparison starts three policies on the identical position after five bookings or passes by the prior Tariff policy, retaining only exact one-slot positions. The load-choice analysis tracks the new policy's own one-slot positions, including cases where it skips. It records the booked wave under both choices and distinguishes a switch to a better, worse or equally paid load. Across the actual purchases, gross improvement less fees equals the mean advantage over always skipping multiplied by the number of runs. The study gives paired 95% intervals resampling whole seeds. [Evidence and results](https://arhaan2.github.io/evalsim-dispatch/loadchoice.html#benchmark) · [Training and reproducibility](training/loadchoice/) · [License](LICENSE)

```sh
npm run audit:loadchoice         # Refit five checkpoints and reproduce the release.
npm run audit:loadchoice:ledgers # Rebuild the paired outcomes independently.
```

The final study revisits the cold-reversal waits and measures the cost of stopping too soon on hot drops. [Published survey-wait outcomes](https://arhaan2.github.io/evalsim-dispatch/waitcost.html#benchmark) · [Research library](https://arhaan2.github.io/evalsim-dispatch/studies.html)
