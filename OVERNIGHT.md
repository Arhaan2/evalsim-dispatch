# Benchmark overnight truck positioning

A dispatcher has two trucks, three depots and ten half-day freight boards. Each Monday–Thursday afternoon, the learned policy decides whether waiting, repositioning empty, or changing the destination of an empty truck will pay through Friday. The current load assignments come from the rolling planner. Mornings and Friday afternoon also follow the planner. [Published study and paired replays](https://arhaan2.github.io/evalsim-dispatch/overnight.html) · [DISPATCH study library](https://arhaan2.github.io/evalsim-dispatch/studies.html)

On fresh weeks the release averaged 338.09 net credits versus 338.36 for the planner. Its observed on-time rate was 74.73% versus 74.63%. The confidence intervals established neither a profit advantage nor a zero-shortfall service match. On new draws of the original double-return pattern, the older fleet agent kept its win while the new agent’s earnings difference was inconclusive. [Measured outcomes](https://arhaan2.github.io/evalsim-dispatch/overnight.html#results)

## Run an agent

Node 22 or later is sufficient for the JavaScript starter. The Python example also needs a local Python 3 interpreter. Both use the standard library. The original five-day fleet starter and each custom policy written against that interface work directly.

```sh
git clone --branch overnight-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite overnight --split validation --policy ./examples/fleetweek-agent.mjs --out validation.json
node tools/reserve.mjs --suite overnight --split test --policy ./examples/fleetweek-agent.mjs --out fresh.json
node tools/reserve.mjs --suite overnight --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify fresh.json
```

Upload any of these reports to the study. The browser checks the reference-bank digest, replays all ten decisions per week, reconstructs the ledger and verifies the comparisons. A replay verifies submitted decisions and their consequences. Authors run their own code locally and should distinguish tuning on public evaluation data from testing a fixed policy. [Verify your report](https://arhaan2.github.io/evalsim-dispatch/overnight.html#own-agent)

A JS module exports a function `(observation, calls) => jointActionId` or a `createPolicy()` factory for per-week memory. A subprocess reads one JSON object per line containing `observation` and `calls`, and writes a flushed line such as `{"action":"W|W"}`. A subprocess is kept alive between weeks. Reset its memory at `observation.epoch === 0`. External agents can choose any legal joint move in all ten rounds. The learned release uses the planner to assign freight. Every policy has one second per action, the same costs and the same public observations. [Observation fields, legal actions and trip costs](FLEETWEEK.md#agent-interface)

## Splits and references

| Split | Weeks | What it measures |
|---|---:|---|
| validation | 256 | Two development schedules |
| test | 2,048 | Four previously unseen schedules with 512 independent weeks each, including early and late double returns |
| archive | 1,024 | Fresh draws on the original double-return schedule |

Export a manifest with `node tools/reserve.mjs --suite overnight --split test --manifest`. Built-in policies are `rl` (new overnight hybrid), `planner` (published rolling planner), `greedy` (immediate net), `previous` (original five-day RL checkpoint) and `noEmpty` (same new policy with its overnight empty departures converted to waits). Start every policy at the same two depots each Monday and balance every ledger through Friday.

Scores report weekly net credits and the percentage of the ten due contracts served. The net ledger deducts loaded travel, empty moves and missed-contract penalties. Net credit differences and service percentage-point differences use paired 95% intervals. The archive compares both the new and former agent to the same planner on the same new tapes.

## Reproduce the experiment

```sh
npm run audit:overnight
npm run audit:overnight:ledgers
npm run audit:overnight:fit
```

The first command refits all five checkpoints and checks market results, counterfactual branches and published evidence. The second reconstructs the policies’ costs, overnight alternatives, comparisons and pass/fail criteria. The third separately checks the fitted coefficients and all candidate-selection returns. The training configuration, test schedule and decision rules were published before fitting. [Frozen protocol](https://github.com/Arhaan2/evalsim-dispatch/tree/aa97786f844b3b08c44be46387f2bd14c3ce7932/training/overnight) · [Training method and results](training/overnight/) · [MIT license](LICENSE)
