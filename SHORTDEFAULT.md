# Benchmark an agent against the short-repair dispatcher

Two trucks, three depots and ten half-days. The short-repair dispatcher would send a truck to one depot. The long-repair dispatcher prefers a different move. On the study page, play either move from a real disagreement and see how its costs and contracts accumulate through Friday. Your own agent can pick any legal move. [Play a decision](https://arhaan2.github.io/evalsim-dispatch/shortdefault.html#play) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#shortdefault)

## Run the same weeks

Use Node.js 22 or newer. The optional Python starter also needs Python 3. The simulator and both starters use their standard libraries.

```sh
git clone --branch shortdefault-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite shortdefault --split validation --name "My dispatcher" --policy ./examples/fleetweek-agent.mjs --out practice.json
node tools/reserve.mjs --verify practice.json
```

Replace the starter with your own policy, choose a split and give the report a new path.

```sh
node tools/reserve.mjs --suite shortdefault --split test --policy ./examples/fleetweek-agent.mjs --out fresh.json
node tools/reserve.mjs --verify fresh.json
node tools/reserve.mjs --suite shortdefault --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
```

Open your report on the study page to replay the actions and verify its ledgers and comparisons locally. You can copy a link or export an offline scorecard. Recipients can verify the shared examples from the link. Give them the original JSON to verify every week behind the aggregate. [Verify and share a scorecard](https://arhaan2.github.io/evalsim-dispatch/shortdefault.html#own-agent)

## Implement a dispatcher

A JavaScript ES module can export a default function `(observation, calls) => actionId` or export a `createPolicy()` factory for per-week memory. An external process reads one JSON line with `observation` and `calls` and flushes one legal joint action, for example `{"action":"W|W"}`. Reset per-week memory on epoch zero. Each decision has a one-second budget. [Agent interface](FLEETWEEK.md#agent-interface) · [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py)

The public observation contains freight, truck positions, forecasts and a warning one board before a depot closes. A second closed board reveals an on-track or delayed repair bulletin. A closed depot permits waiting and empty departures. Loaded freight touching the depot and empty inbound moves are unavailable. A missed contract costs 34 credits, and each of the ten contracts counts toward on-time service.

| Split | Weeks | What it measures |
|---|---:|---|
| `validation` | 256 | Develop an agent on two freight patterns |
| `test` | 16,384 | Four new freight patterns with afternoon starts and repairs lasting one to five half-days |
| `clean` | 2,048 | The same four freight patterns without a closure |
| `archive` | 4,096 | New closure-free draws of the original double-return pattern |

List the seeds and timing distributions with `node tools/reserve.mjs --suite shortdefault --split test --manifest`. The cases are public for replication. When reporting scores, disclose which splits you used for tuning.

## Compare six policies

| Policy key | Decision rule |
|---|---|
| `planner` | Rolling planner using the public demand bulletin and closure model |
| `flatRisk` | Historical constant-penalty dispatcher using the same legal moves |
| `shortGate` | Frozen checkpoint fitted on one-to-three-half-day repairs and calibrated and selected on a mixed-duration bank |
| `longGate` | Frozen checkpoint fitted, calibrated and selected on mixed-duration repairs |
| `rl` | Starts from the short policy and evaluates the long policy's move at disagreements |
| `flatGate` | Replaces the new policy's two state-dependent predictions with their calibration averages |

Both frozen policies may propose holding position or moving an empty truck. A ‘long’ move is whichever action the long-trained policy picks on that board. The new agent requires both its forecast of extra earnings and its service-adjusted forecast to exceed its selected hurdle before switching. The short policy wins a tie.

Net credits deduct travel and missed-contract costs. Service differences are percentage points of due contracts fulfilled. The first two references are the registered baselines. To see what a newly learned move contributed, compare against always taking the frozen short policy. On weeks without a closure the release follows the historical constant policy. [Paired results and decision replays](https://arhaan2.github.io/evalsim-dispatch/shortdefault.html#results)

## Reproduce the study

```sh
npm run audit:shortdefault
npm run audit:shortdefault:fit
npm run audit:shortdefault:ledgers
```

The first command refits the five checkpoints and regenerates the scored results and page for comparison. The other two independently check the training targets and the ledger evidence. [Protocol frozen before training](https://github.com/Arhaan2/evalsim-dispatch/blob/9ec4f2ef36b6d61134625bc959d52dca3a137935/training/shortdefault/PROTOCOL.md) · [Five checkpoints locked before scoring](https://github.com/Arhaan2/evalsim-dispatch/tree/ba00d572f515e3c4107a27b73264577c198c0ff4/docs/data/shortdefault) · [Training implementation](training/shortdefault/) · [MIT license](LICENSE)
