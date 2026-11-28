# Benchmark a dispatcher before a depot closes

Two trucks have ten half-days to serve signed contracts and spot freight across three depots. One board before a closure, a public notice names the affected depot. The learned agent can change either truck's assignment on that board. Fit 73 takes over from the new positions for the rest of the week. [Play “Can you save Friday’s delivery?”](https://arhaan2.github.io/evalsim-dispatch/preposition.html#play) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#preposition)

## Try the public benchmark

Use Node.js 22 or newer. The tagged checkout includes the simulator, checkpoints and reference banks. The JavaScript starter has no external dependencies.

```sh
git clone --branch preposition-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite preposition --split validation --policy ./examples/fleetweek-agent.mjs --name "My dispatcher" --out practice.json
node tools/reserve.mjs --verify practice.json
```

A JavaScript agent exports a default decision function taking `(observation, legalActions)`, or a `createPolicy()` factory that starts a new policy each week. A Python agent reads one JSON line per decision and flushes one legal joint-action ID. Reset its memory at epoch zero. Unlike the research agent, an entrant may choose any legal action on every board. Each decision has a one-second budget. [Agent interface](FLEETWEEK.md#agent-interface) · [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py)

```sh
node tools/reserve.mjs --suite preposition --split test --out my-fridays.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify my-fridays.json
```

Import the report in the study to see paired earnings and service, replay individual weeks, and share a scorecard. The scorecard link includes examples. A recipient with the full report can verify every decision and all the ledgers. [Open the scorecard desk](https://arhaan2.github.io/evalsim-dispatch/preposition.html#own-agent)

| Split | Weeks | Conditions |
|---|---:|---|
| `validation` | 256 | Two development schedules with one closure warning per week |
| `test` | 32,768 | Eight unseen schedules, one warning on Tuesday, Wednesday or Thursday morning |
| `clean` | 4,096 | The eight fresh schedules on different seeds, all depots open |
| `archive` | 4,096 | New draws from the original double-return schedule, all depots open |

The test bank is divided into eight checksummed files, one per schedule. Use `--manifest` with `--suite preposition --split test` to list the seeds and settings. Develop on validation. When publishing results, disclose any public weeks used to tune your agent.

## Read the outcome

**Signed deliveries.** Each half-day has one signed contract. Compare the *same* contract across both agents' trajectories to count newly served and newly missed deliveries. A Friday delivery saved can come at the expense of another contract earlier that week. The challenge reveals both trucks' ten actions, the signed Friday load, and the weekly cost of choosing either branch. Featured examples are selected for illustration. The four primary comparisons cover every fresh week. [Delivery counts and replays](https://arhaan2.github.io/evalsim-dispatch/preposition.html#deliveries)

**Net credits.** Both agents pay their actual empty and loaded travel costs and 34 credits for each missed contract. We evaluate higher weekly net and higher on-time delivery against both frozen fit 73 and the rolling closure planner. Each primary test requires a strictly positive lower paired 95% bound. Each agent has the same current freight, positions, repair notice and forecasts; realized future freight and repair duration are hidden from play. [Registered tests](https://github.com/Arhaan2/evalsim-dispatch/blob/3f20b99a37c9f72bc4bfbff981020dec5a6134c8/training/preposition/PROTOCOL.md)

## Run a reference policy

Use `rl` or `fit-73` for the preregistered warning-time release, or `fit-101` and `fit-211` for the other independent fits. The built-in comparator `previous` is the frozen switch-cost fit 73. It is also the controller all three research policies use outside a warning. Other choices are `planner`, `shortGate` (always short) and `flatRisk` (constant penalty). For the mechanism checks, `warningPlanner` uses the rolling planner only at the warning and `untrained` removes the two fitted regressions while keeping the primary settings. [Pretest diagnostic definitions](training/preposition/DIAGNOSTICS.md)

```sh
node tools/reserve.mjs --suite preposition --split test --policy rl --out released.json
node tools/reserve.mjs --suite preposition --split test --policy previous --out frozen-fit-73.json
npm run audit:preposition
npm run audit:preposition:fit
npm run audit:preposition:ledgers
```

The audits refit all three checkpoints, recalculate the weekly results, reproduce the study page and independently replay the trajectories. [Training source](training/preposition/) · [MIT license](LICENSE)
