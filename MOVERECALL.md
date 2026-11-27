# Benchmark your dispatcher on missed long-repair moves

When a depot closes, two trained dispatchers sometimes recommend different moves. The short-repair dispatcher learned on closures lasting up to three half-days. The long-repair dispatcher also saw closures lasting four or five. Both can hold or move a truck. This study tests whether an agent can catch profitable alternatives that the previous detector passes up. You can submit any legal action for both trucks on every board. [Play a decision](https://arhaan2.github.io/evalsim-dispatch/moverecall.html#play) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#moverecall)

## Try the validation weeks

Use Node.js 22 or newer. Clone the tagged release to get the exact simulator, published checkpoints and case banks. The JavaScript starter and CLI use the standard library.

```sh
git clone --branch moverecall-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite moverecall --split validation --name "My dispatcher" --policy ./examples/fleetweek-agent.mjs --out practice.json
node tools/reserve.mjs --verify practice.json
```

Replace the starter with your own module. Its default export receives `(observation, calls)` and returns a legal joint action ID. An optional `createPolicy()` factory creates a fresh policy at the start of each week. Python agents read a JSON line with the same observation and calls and flush one action such as `{"action":"W|W"}`. Reset per-week memory at epoch zero. The budget is one second per decision. [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py) · [Full agent interface](FLEETWEEK.md#agent-interface)

## Run the fresh test and share a result

```sh
node tools/reserve.mjs --suite moverecall --split test --name "My dispatcher" --policy ./examples/fleetweek-agent.mjs --out fresh.json
node tools/reserve.mjs --verify fresh.json
node tools/reserve.mjs --suite moverecall --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify double-return.json
```

Choose your JSON report on the study page. The verifier replays your moves and checks the net credits, service and comparisons. Copy the scorecard link to share example weeks, or download an offline scorecard. Share the original JSON when readers need to verify every decision. [Verify a report and share a scorecard](https://arhaan2.github.io/evalsim-dispatch/moverecall.html#own-agent)

| Split | Weeks | What it covers |
|---|---:|---|
| `validation` | 256 | Two freight patterns for practice |
| `test` | 32,768 | Eight held-out freight patterns, afternoon closures and repairs lasting one to five half-days |
| `clean` | 4,096 | The same eight patterns with fresh draws and all depots open |
| `archive` | 4,096 | The original double-return schedule with fresh draws and all depots open |

Use `node tools/reserve.mjs --suite moverecall --split test --manifest` to list the cases. For a comparable submission, develop on validation and disclose any previously opened test cases. Each agent sees the current public board, truck positions, forecasts and repair updates. The verifier knows the actual freight and repair outcomes.

## Understand the two comparisons

**Move recognition** uses one route for both detectors. At each disagreement on the short dispatcher's route, replay both proposed actions against identical future freight and then follow short to Friday. Recall is the fraction of profitable alternatives a detector selected. Precision is the fraction of its selections that earned extra credits. The 67 misses that inspired the study come from a different set of weeks. Here the old and new detector face exactly the same opportunities. [Compare move recognition](https://arhaan2.github.io/evalsim-dispatch/moverecall.html#detection)

**Weekly performance** lets each agent's moves determine its subsequent truck positions. It scores the ten decisions through Friday, subtracting travel costs and 34 credits per missed contract. All ten deadlines count toward on-time service, including those affected by a closure. The three primary comparators are always short, the constant penalty and the rolling planner. The rules, predecessor, always-long expert and constant-prediction control are available for inspection. [Weekly results](https://arhaan2.github.io/evalsim-dispatch/moverecall.html#results)

## Reproduce the study

```sh
npm run audit:moverecall
npm run audit:moverecall:fit
npm run audit:moverecall:ledgers
```

These commands refit the five checkpoints, rebuild and compare the recorded scores and study page, and independently check fits and recorded trajectories. Seed 13 was chosen for release before training. The eight tests and the procedure for selecting a switch were registered before the test weeks were opened. [Registered protocol](https://github.com/Arhaan2/evalsim-dispatch/blob/16b494a2e0e831dd8217c687468099934e98984c/training/moverecall/PROTOCOL.md) · [Five models locked before evaluation](https://github.com/Arhaan2/evalsim-dispatch/tree/d593b0dbaeec6f4f9a4b26d7ce70849f30dad483/docs/data/moverecall) · [Training code](training/moverecall/) · [MIT license](LICENSE)
