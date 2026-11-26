# Benchmark your depot closure dispatcher

Two trucks have ten half-days to serve freight across three depots. A warning arrives one board before a depot closes. One truck can wait, leave empty, or carry a legal load. If repairs last long enough, a second bulletin updates the outlook. Play a decision, see what each choice earned by Friday, then put your own agent on the same weeks. [Play the closure](https://arhaan2.github.io/evalsim-dispatch/closure.html#play) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#closure)

## Run a JavaScript or Python agent

Node.js 22 or newer runs the benchmark. The Python starter also requires Python 3. Both use the standard library.

```sh
git clone --branch closure-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite closure --split validation --policy ./examples/fleetweek-agent.mjs --out practice.json
node tools/reserve.mjs --suite closure --split test --name "My dispatcher" --policy ./examples/fleetweek-agent.mjs --out closure.json
node tools/reserve.mjs --suite closure --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify closure.json
```

Open the report on the study page to verify every joint move and weekly ledger. Copy the share link or download the scorecard. It includes your weekly earnings and on-time service relative to both baselines, paired intervals and representative weeks when your agent gained or lost credits relative to the planner when available. A recipient can inspect the examples. Verification of the full aggregate requires the complete source report. Your score is a self-benchmark on public cases. [Verify a report and export a scorecard](https://arhaan2.github.io/evalsim-dispatch/closure.html#own-agent)

## Write your policy

A JavaScript ES module exports a default function accepting `(observation, calls)` and returning a legal joint action ID. For per-week memory export a `createPolicy()` factory. An external process reads one JSON line containing `observation` and `calls`, then flushes a response such as `{"action":"W|W"}`. Reset memory at `observation.epoch === 0`. Use any legal joint move on each of ten boards. Each decision has a one-second budget. [Fleet agent interface](FLEETWEEK.md#agent-interface)

`observation.incident.status` is `clear`, `warning`, `closed` or `reopened`. A warning identifies `depot` (0 = Harbor, 1 = Inland, 2 = Junction) and the `start` epoch. A repair `update` of `on-track` or `delayed` first becomes observable on the second closed board. The actual reopening time stays hidden until it occurs. Closed depots can host an idle truck or allow an empty departure. The menu excludes inbound empty moves and freight that touches the closed depot. Missed contracts cost 34 credits, including loads made infeasible by the closure. All ten deadlines count toward on-time service.

| Split | Weeks | Use |
|---|---:|---|
| validation | 256 | Develop and debug an agent on two schedules |
| test | 8,192 | Four new freight schedules, unseen afternoon closure timings and repairs up to five half-days |
| clean | 2,048 | The same four freight patterns on different draws without a closure |
| archive | 4,096 | New draws of the original double-return schedule, without a closure |

Built-in references are `rl`, `planner` and `flatRisk`. The rolling planner accounts for closure restrictions, repair uncertainty, and the field update. The constant-penalty agent adapts the published penalty and proposal weights to that planner and the identical legal menu. The new policy learns from Friday earnings and served-contract returns on closure weeks. On clear and reopened boards it takes the constant-penalty agent's action. External agents see the same public information and can pick any legal response. To list seeds and timing profiles, run `node tools/reserve.mjs --suite closure --split test --manifest`. Disclose any use of public test cases to tune a submitted policy.

## Reproduce the experiment

```sh
npm run audit:closure
npm run audit:closure:fit
npm run audit:closure:ledgers
```

The first command refits the five checkpoints and rebuilds the scores and page. The other two independently check training, action choices, freight ledgers, intervals and playable forks. [Protocol frozen before training](https://github.com/Arhaan2/evalsim-dispatch/blob/64806116adf4486d719db55c4be918f6767d3157/training/closure/PROTOCOL.md) · [Checkpoints locked before testing](https://github.com/Arhaan2/evalsim-dispatch/tree/e523aa78af04d7508551dd00150fd6770c564bea/docs/data/closure) · [Training and results](training/closure/) · [MIT license](LICENSE)
