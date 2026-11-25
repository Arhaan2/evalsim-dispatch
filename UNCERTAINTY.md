# Benchmark an agent that can decline an uncertain override

The two-truck dispatcher has a choice on Monday through Thursday nights. When the preceding agent recommends an empty truck move that differs from the rolling planner's choice, the new agent can follow that recommendation or keep the plan. Both actions honor the freight already assigned to each truck. The model estimates how far the proposed move's realized Friday earnings could fall below its predicted advantage, on average, using the freight and forecasts available at dispatch. [Play the decision](https://arhaan2.github.io/evalsim-dispatch/uncertainty.html#replays) · [Measured results](https://arhaan2.github.io/evalsim-dispatch/uncertainty.html#results)

On 8,192 fresh weeks, the release averaged +0.443 net credits per week and +0.035 percentage points of service against the planner. Both paired intervals crossed zero. On 4,096 new double-return weeks, it kept a +1.525-credit advantage (paired 95% interval +0.788 to +2.274). The fresh-week data also leave the earnings advantage over either penalty control unresolved. [Release results and decision replays](https://arhaan2.github.io/evalsim-dispatch/uncertainty.html#results)

## Benchmark your dispatcher

Use Node.js 22 or later. Both starters use the standard library. The Python example also needs a local Python 3 interpreter.

```sh
git clone --branch uncertainty-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite uncertainty --split validation --policy ./examples/fleetweek-agent.mjs --out validation.json
node tools/reserve.mjs --suite uncertainty --split test --policy ./examples/fleetweek-agent.mjs --out fresh.json
node tools/reserve.mjs --suite uncertainty --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify fresh.json
```

Replace the starter path with your agent. A JavaScript policy takes `(observation, legalActions)` and returns a legal joint action ID. You can also export a `createPolicy()` factory for per-week memory. A subprocess reads one JSON line containing `observation` and `calls` and returns a flushed line such as `{"action":"W|W"}`. Reset subprocess memory at `observation.epoch === 0`. You can choose any legal action across all ten half-days, including actions that assign freight. The dispatch budget is one second per decision. [Fleet observation and action interface](FLEETWEEK.md#agent-interface)

Upload a report to the study to verify the exact actions, ledger, and comparisons on your device. Select a week to follow the dispatchers from Monday to Friday. Public cases are available with `--suite uncertainty --split test --manifest`. Disclose any use of evaluation weeks to tune your policy when sharing benchmark results. [Verify and replay a report](https://arhaan2.github.io/evalsim-dispatch/uncertainty.html#own-agent)

## Cases and policies

| Split | Weeks | Market patterns |
|---|---:|---|
| validation | 256 | Two development schedules |
| test | 8,192 | Four unseen schedules with 2,048 independent weeks each |
| archive | 4,096 | Fresh draws of the original double-return schedule |

| Built-in policy | Decision rule |
|---|---|
| rl | Apply the released policy's learned penalty for a proposed override's downside |
| planner | Keep the rolling planner's decision |
| override | Apply the preceding override agent, including every recommendation that it makes |
| meanOnly | Use the new policy's mean earnings and service estimates with the downside penalty removed |
| flatRisk | Give each proposal the same calibration-wide downside estimate, keeping the selected penalty weight |
| overnight | Run the earlier overnight positioning agent |
| previous | Run the original fleet RL agent, which can also reassign signed work |

Each reference runs an entire week on the same exogenous freight. Net credits deduct loaded travel, empty running and missed-contract penalties. On-time service measures the share of ten due contracts served. Estimates and case-level differences are also available for every recommendation on the release's path in the published split files. [Scored results](docs/data/uncertainty/results.json) · [Benchmark module](docs/lib/uncertainty-benchmark.js)

## Reproduce the release

```sh
npm run audit:uncertainty
npm run audit:uncertainty:ledgers
npm run audit:uncertainty:fit
```

The first command fits and calibrates all five policies, repeats the selection procedure and regenerates the published scores and page for comparison. The second independently verifies score intervals, weekly ledgers, alternatives through Friday and downside estimates against their realized outcomes. The third checks fitting, calibration and train-only selection. [Pre-training protocol](https://github.com/Arhaan2/evalsim-dispatch/blob/4c2ab7f177beb12760fdc5714a99def62ca554cb/training/uncertainty/PROTOCOL.md) · [Training report](training/uncertainty/) · [Preceding override study](OVERRIDE.md) · [MIT license](LICENSE)
