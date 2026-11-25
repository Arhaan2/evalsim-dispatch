# Benchmark an overnight planner override

Two trucks dispatch between three depots from Monday morning to Friday afternoon. At an overnight decision, you know today's bookings, the previous demand hubs, the trucks' locations, travel costs and Monday's fallible forecast. Moving the spare can unlock tomorrow's freight or leave it at the wrong depot. The release uses the rolling planner for signed freight and learns whether to accept a different overnight placement. External agents can choose any legal joint action across the whole week. [Play the decision](https://arhaan2.github.io/evalsim-dispatch/override.html#replays) · [Measured results](https://arhaan2.github.io/evalsim-dispatch/override.html#results)

The release recovered a **+2.32-credit** advantage over the planner on 2,048 new double-return weeks. On 4,096 weeks from four unseen schedules, its earnings difference was +0.43 credits per week and its service difference was +0.056 percentage points. Both fresh-week intervals crossed zero. [Paired comparisons and all five fits](https://arhaan2.github.io/evalsim-dispatch/override.html#results)

## Run your own dispatcher

Clone the tagged release and use Node.js 22 or later. The following commands need no installed packages. The Python starter also needs Python 3. Both examples use the same observation and action interface as the first fleet lab.

```sh
git clone --branch override-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite override --split validation --policy ./examples/fleetweek-agent.mjs --out validation.json
node tools/reserve.mjs --suite override --split test --policy ./examples/fleetweek-agent.mjs --out fresh.json
node tools/reserve.mjs --suite override --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify fresh.json
```

Replace the starter with your policy. A JavaScript module exports a function taking `(observation, legalActions)` and returning a joint action ID. Modules may export a `createPolicy()` factory for per-week memory. A subprocess receives one JSON object per line with `observation` and `calls` and writes a flushed response such as `{"action":"W|W"}`. It stays alive across weeks, so reset its history when `observation.epoch === 0`. Policies have one second per decision. Every action names a move for each truck. [Complete observation and action interface](FLEETWEEK.md#agent-interface)

Upload your report to the study to reproduce its scores and step through each half-day. The browser verifies the benchmark bank and computes the ledgers from your decisions on your device. An accepted report establishes that its submitted actions earned the displayed score. The public seeds let you reproduce comparisons and should be disclosed if you used them to tune. [Verify and replay your report](https://arhaan2.github.io/evalsim-dispatch/override.html#own-agent)

## Compare policies on the same weeks

| Split | Weeks | Purpose |
|---|---:|---|
| validation | 256 | Two separate patterns for developing an external agent |
| test | 4,096 | Four previously unseen schedules with 1,024 weeks each |
| archive | 2,048 | New draws on the original double-return schedule |

Use `--manifest` to export the exact public cases for a split. The built-in `rl` agent is the preregistered fit. The `planner` baseline keeps the planner's choice at every board. The `always` baseline takes the release model's best non-planner alternative whenever one exists; it can initiate, cancel or redirect an empty trip. The `overnight` and `previous` references run the preceding overnight RL and original unrestricted fleet RL respectively. The `greedy` reference maximizes the immediate net return. Each starts every week from the same depots and sees identical arrivals. Net earnings deduct loaded travel, empty running and penalties for missed contracts. On-time service counts the fraction of the ten due contracts served.

## Reproduce the study

```sh
npm run audit:override
npm run audit:override:ledgers
npm run audit:override:fit
```

The first command retrains the five policies and reproduces the scores and public page. The second independently balances each truck's ledger, checks the alternative outcomes through Friday and recomputes uncertainty intervals. The third checks the trained models. The simulator, inference code, checkpoints and results ship with the MIT-licensed repository. [Study protocol](training/override/PROTOCOL.md) · [Training and findings](training/override/) · [Preceding overnight study](OVERNIGHT.md) · [License](LICENSE)
