# Benchmark survey-induced waiting

A truck has one slot left. The original dispatcher would book the current load using public freight history, but a newly purchased survey makes it want to wait. This study trains a stopping rule to recognize when passing up that load would cost money. Try the same decision in the browser, then compare your own dispatcher on the fixed shifts. [Public study](https://arhaan2.github.io/evalsim-dispatch/waitcost.html) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html)

The release beat the independent planner on fresh cold reversals but fell short of always skipping by exactly 3.75 credits in total fees. The earlier hot-drop planner win held on the archived patterns and was inconclusive on the fresh ones. All original interrupted-drop retention checks passed. [Training and paired intervals](training/waitcost/)

## Run your agent

Node.js 22 or later runs the JavaScript starter offline. The pinned MIT-licensed release includes the environment, trained checkpoints, independent planner, test manifests, scored reference trajectories and offline verifier. No account or package installation is required.

```sh
git clone --branch waitcost-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite waitcost --split validation --policy ./examples/lastslot-agent.mjs
node tools/reserve.mjs --suite waitcost --split test --policy ./examples/lastslot-agent.mjs --out my-report.json
node tools/reserve.mjs --verify my-report.json
```

Upload the JSON to the study page to compare your score and replay your decisions. The browser verifies the manifest, freight, acquired readings, fees and paired comparisons on your device. [Verify your report](https://arhaan2.github.io/evalsim-dispatch/waitcost.html#own-agent) · [JavaScript starter](examples/lastslot-agent.mjs) · [Python starter](examples/lastslot_agent.py)

```sh
node tools/reserve.mjs --suite waitcost --split test --out python-report.json -- python3 examples/lastslot_agent.py
node tools/reserve.mjs --suite waitcost --split retention --policy ./examples/lastslot-agent.mjs --out original.json
node tools/reserve.mjs --suite waitcost --split archive --policy ./examples/lastslot-agent.mjs --out archive.json
node tools/reserve.mjs --suite waitcost --split test --manifest > manifest.json
```

Export a default JavaScript function taking `(observation, calls)`, or a `createPolicy()` factory for private per-shift memory. Subprocess policies read a JSON Lines request with the same fields and return one flushed response, such as `{"action":"pass"}`. On each freight wave return `accept` when you have a free slot, or `pass`. After wave five, `phase === "survey"` offers `buy` or `skip`. The price has been public since wave one. Buying debits the fee immediately and reveals a reading from 0 through 6. Skipping leaves the reading null. The sixth signed offer follows the survey decision, and the ordinary delayed bulletin arrives at wave seven. Your agent and the fee-aware planner can buy with any remaining capacity. The new policy buys only with one slot left.

The score in `netCents` equals `grossCents - feeCents`. A credit contains 100 cents. For a custom shift, import `runWaitcostCase` from `evalsim-dispatch/waitcost` and call it with a config such as `{seed: 42, family: "brief-peak-cold", priceCents: 37}` and your decision function. The simulator supports every whole-cent price from zero to one credit.

## Fixed splits

| Split | Market schedules | Seeds | Freight tapes | Priced runs |
|---|---|---|---:|---:|
| validation | Two development openings with both endings | 19200000–19200031 | 128 | 896 |
| test | Eight unseen openings with both endings | 19300000–19301023 | 16,384 | 114,688 |
| retention | Exact original interrupted drop | 19400000–19401023 | 1,024 | 7,168 |
| archive | Previous Load Choice fresh markets on new draws | 19500000–19500127 | 2,048 | 14,336 |

Freeze your own policy after validation. Each tape is repeated at 0, 5, 10, 25, 50, 75 and 100 cents. Primary cold-reversal and hot-drop tests use six positive fees, four patterns per target and 1,024 seed clusters. The simulator reuses the same latent draws across fees and policies. [Market definitions](docs/lib/waitcost.js)

## Read the controls

| CLI policies | Decisions |
|---|---|
| `rl`, `rlNever`, `rlAlways` | New learned stopping rule with optional acquisition, forced skipping, or compulsory acquisition at a one-slot gate |
| `planner` | Independent fee-aware Bayesian planner that manages its own opening, bookings and purchases |
| `loadchoice` | Full previous checkpoint, including its own purchase decision |
| `unguarded`, `unguardedAlways` | Same new purchase decision or a compulsory one-slot purchase, followed by the previous freight decisions |
| `alwaysStop`, `alwaysStopForced` | Same two purchase conditions, then immediately book on every eligible informed-pass and blind-book disagreement |
| `lastslot`, `tariff`, `paid`, `stochastic`, `booking`, `survey`, `rally`, `trust`, `drift`, `turns` | Earlier reference policies evaluated on the same waves and prices |

A harmful wait ends with a later load and lower **gross freight** than the same dispatcher skipping. The stopping-rule comparison instead holds the purchase and fee fixed, then measures the difference between intervening and taking the previous informed action. In the reference bank, `loads` records the guarded buy, skip, unguarded buy and blanket-stop buy booking waves in that order for each eligible one-slot case. Wave zero denotes no booking by close. The full-shift benchmark includes every shift from wave one. A separate comparison gives the new policy, forced skip and planner an identical one-slot position after the prior Tariff opener. [Results and worked examples](https://arhaan2.github.io/evalsim-dispatch/waitcost.html#benchmark) · [Training study](training/waitcost/) · [License](LICENSE)

```sh
npm run audit:waitcost
npm run audit:waitcost:ledgers
```

The first command refits all five models and verifies the published results. The second independently reconstructs the ledgers, waiting decisions and paired confidence intervals.
