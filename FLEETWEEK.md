# Benchmark a five-day fleet dispatcher

Two trucks start Monday at Harbor and Inland. Each half-day you get a signed contract, two optional loads, the Monday forecast for all ten rounds, and the history of realized freight hubs and loads. Assign both trucks. An empty move or a booked load changes where that truck starts the next round, including overnight. The week closes after Friday afternoon with no terminal bonus. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/fleetweek.html) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html)

## Run locally

Node 22 or later runs the lab and its JavaScript starter with no package installation. To use the second example, supply a local Python 3 interpreter. Both starters use only their language’s standard library.

```sh
git clone --branch fleetweek-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite fleetweek --split validation --policy ./examples/fleetweek-agent.mjs --out validation.json
node tools/reserve.mjs --suite fleetweek --split test --policy ./examples/fleetweek-agent.mjs --out fleet.json
node tools/reserve.mjs --verify fleet.json
node tools/reserve.mjs --suite fleetweek --split test --out python.json -- python3 examples/fleetweek_agent.py
```

Use `--policy rl`, `--policy planner` or `--policy greedy` for a reference. Export the complete manifest with `node tools/reserve.mjs --suite fleetweek --split test --manifest`. Upload a report to verify its ten joint decisions per week, all costs and comparisons in your browser. Then pick a week to inspect a round-by-round replay. The verifier reconstructs outcomes from submitted actions; reports are self-run, and replay does not certify a submitted agent's source, training history or runtime. [Verify your report](https://arhaan2.github.io/evalsim-dispatch/fleetweek.html#own-agent)

## Agent interface

JavaScript modules export a default decision function or an optional `createPolicy()` factory for per-week memory. A subprocess reads one JSON Lines request with `observation` and `calls` fields, then prints a flushed line such as `{"action":"W|W"}`. A subprocess lives across weeks; reset week-local state when `observation.epoch === 0`. The public protocol allows up to one second per decision. In-process modules and subprocess decisions are timed by the CLI. Run only agents you trust on your computer.

The observation has `epoch` (0–9), `day` (1–5), `period` (AM/PM), ordered `positions`, current `hub`, three signed `orders`, ten forecast probability vectors and completed-round `history`. Depot indices 0, 1 and 2 refer to Harbor, Inland and Junction. The simulator withholds scenario identity and random seed from policies. Each legal joint move gives the indexed trucks’ `moves`, next `positions`, and its immediate costs and revenue. Return its string `id`. Each truck may wait (`W`), travel empty to a different depot (`E0`, `E1`, `E2`), or book an available local load (`C`, `S0`, `S1`). The trucks cannot take the same load.

```js
export default function dispatch(observation, calls) {
  return calls.reduce((best, move) => move.net > best.net ? move : best).id;
}
```

For custom practice weeks, import `createFleetWeek` or `runFleetWeek` from `evalsim-dispatch/fleetweek` in a project with the source package installed. `runFleetWeek({family:"steady-market",seed:42}, dispatch)` returns the ten actions, trace and final ledger.

## How scores work

All loads take a half-day. Loaded travel costs 0.45 credits per mile, empty travel 0.60, with each trip cost rounded to the nearest credit. Distances are Harbor–Inland 20, Harbor–Junction 32 and Inland–Junction 26 miles. A missed contract costs 34 credits. On-time service is the number of the ten contracts served by their deadline. Net credits equal revenue less loaded travel, empty travel and missed-contract penalties. Empty miles and weeks with seven or more contracts served are also reported.

Validation covers 256 weeks on two held-out schedules. Test covers 2,048 fresh weeks on four other schedules (512 per schedule). None of these schedule shapes occurred among the seven training families, including after relabeling depots. Both split names and seeds are public for reproduction. Policies tested repeatedly on the published seeds should disclose that when comparing against the original held-out results.

Five independent fitted checkpoints ship with the experiment. The study fixed its primary fit in advance. Reference policies and external agents use identical signed orders, legal moves and costs. The rolling planner filters the noisy bulletin and observed hubs using a specified demand-persistence model, then optimizes placements over the remaining week. Its forecast model can be wrong. The greedy policy considers just the current round. [Results, uncertainty and training method](training/fleetweek/) · [Frozen scoring protocol](training/fleetweek/PROTOCOL.md) · [MIT license](LICENSE)

```sh
npm run audit:fleetweek
npm run audit:fleetweek:ledgers
```
