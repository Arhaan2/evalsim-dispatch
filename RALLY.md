# Benchmark a DISPATCH agent on brief rallies and lasting turns

One freight offer arrives at each of eight waves. You have room for two bookings. A rally can fade before the close or keep building. The desk shows signed prices immediately and revises its survey twice, using noisy, two-wave-old information. The challenge is deciding whether the next offer is worth a truck slot. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/rally.html) · [View the scorecard](https://arhaan2.github.io/evalsim-dispatch/rally.html#benchmark)

## Run your own agent

Use Node.js 22 or later. The tagged checkout contains the trained policies, deterministic simulator and score verifier. The JavaScript starter has no install step.

```sh
git clone --branch rally-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite rally --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --suite rally --policy ./examples/reserve-agent.mjs --out rally.json
node tools/reserve.mjs --verify rally.json
```

Edit the starter’s decision function or export a `createPolicy()` factory for per-shift memory. The harness calls your function with the current public observation and legal actions. You can also launch a local program that reads one JSON request per line and returns a flushed response such as `{"action":"pass"}`. Wave zero starts a new shift. Both interfaces see the current signed offer, updated public forecast, history of revealed offers and free slots. [JavaScript starter](examples/reserve-agent.mjs) · [Python starter](examples/reserve_agent.py) · [Full interface](DRIFT.md#plug-in-your-agent)

```sh
node tools/reserve.mjs --suite rally --out my-python.json -- python3 examples/reserve_agent.py
node tools/reserve.mjs --suite rally --split retention --policy ./examples/reserve-agent.mjs --out original.json
node tools/reserve.mjs --suite rally --split archive --policy ./examples/reserve-agent.mjs --out archive.json
node tools/reserve.mjs --suite rally --split test --manifest > rally-manifest.json
```

Open your report in the lab to replay every booking locally and compare your agent against the published references. The JavaScript package also exports `runRallyCase` from `evalsim-dispatch/rally`. The code and the synthetic benchmark are available under the MIT license. [Open a report](https://arhaan2.github.io/evalsim-dispatch/rally.html#own-agent) · [License](LICENSE)

## Which shifts will my agent face?

| Split | Patterns | Market seeds | Shifts |
|---|---|---|---:|
| `validation` | Two development openings, each with both endings | 12200000–12200127 | 512 |
| `test` | Four previously unseen openings, each with both endings | 12300000–12301023 | 8,192 |
| `retention` | The exact original interrupted-drop generator | 12400000–12401023 | 1,024 |
| `archive` | The eight previous Trust test paths, on fresh draws | 12500000–12501023 | 8,192 |

Every fresh reversal and interrupted drop has a matched twin. The pair shares its opening price draws and forecasts, then demand either cools or sustains the rally. Hot and cold describe offer probabilities, so a hot market can still produce a low signed price. Every reference and submitted policy sees the same freight for a given family and seed. Develop on validation, then freeze your own agent before scoring the other three splits.

## What is compared?

| CLI policy | Decision rule |
|---|---|
| `rl` | Learned market model, updates its belief using signed offers and bulletins and plans the remaining bookings |
| `ablated` | Separately fitted control using the current offer and bulletin, wave, free slots and price supports |
| `stochastic` | Frozen distribution-aware planner using the currently posted odds |
| `trust` | Previously released router over the planner and the two earlier history policies |
| `drift`, `turns`, `closes` | Each earlier RL policy acting on its own |
| `adaptive` | Frozen planner that adjusts the forecast with recent signed-price surprises |

The primary success criteria require beating the distribution-aware planner separately on cold-ending reversals and hot-ending interrupted drops. Each lower paired 95% confidence bound must exceed zero. On the original interrupted drop the agent must beat the planner and come within one credit of each of Trust, Drift and Turns under the same interval rule. The diagnostic also scores its probability of a hot finish against known endings after each wave. The prespecified diagnostic is at wave seven. [Frozen criteria](training/rally/protocol.mjs) · [Results and training](training/rally/)

## How did the released policy do?

On the two primary fresh slices the planner earned 0.54 more credits per cold-ending reversal and 1.87 more per hot-ending drop. On the original interrupted drop the learned policy scored 48.95 to the planner’s 37.16 and qualified for retention against Trust, Drift and Turns. At wave seven the full model’s ending predictions were correct 52.1% of the time, compared with 61.7% for the current-only model. [Read the paired intervals, per-wave forecasts and training details](training/rally/) · [Replay a matched booking decision](https://arhaan2.github.io/evalsim-dispatch/rally.html#matched-decision)
