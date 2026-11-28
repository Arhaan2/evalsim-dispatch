# Benchmark a dispatcher against fit 73

An earlier DISPATCH agent learned to take long-repair moves the preceding dispatcher would have skipped. Six of its 24 additions lost credits. This study trains a second decision on top of the frozen agent. When fit 73 adds a move, should the fleet go ahead or follow the short-repair expert? The published benchmark lets your own dispatcher choose any legal joint action. [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#addguard)

## Start with 256 practice weeks

Use Node.js 22 or newer. The tagged checkout contains the simulator, trained policies, schedules and reference ledgers. The JavaScript example has no external dependencies.

```sh
git clone --branch addguard-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite addguard --split validation --policy ./examples/fleetweek-agent.mjs --name "My dispatcher" --out practice.json
node tools/reserve.mjs --verify practice.json
```

Export a function taking a public observation and the legal joint actions and returning an action ID. Use `createPolicy()` to keep state for one week. The Python starter uses one JSON line per decision. Reset its state at epoch zero and flush one legal action ID per line. Each policy has one second per decision. [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py) · [Agent interface](FLEETWEEK.md#agent-interface)

## Run the same fresh weeks

```sh
node tools/reserve.mjs --suite addguard --split test --out fresh.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify fresh.json
```

| Split | Weeks | What it measures |
|---|---:|---|
| `validation` | 256 | Two development schedules with depot closures |
| `test` | 65,536 | Eight unseen freight schedules with closures of one to five half-days |
| `clean` | 4,096 | The same eight schedules on new seeds with all depots open |
| `archive` | 4,096 | New open-depot weeks from the original double-return schedule |

The eight fresh families each have a checksummed reference file. The CLI reads them locally. To print any split, use `--manifest` with `--suite addguard --split NAME`. Develop on validation and disclose which public weeks you used when you share a result.

Open your JSON on the study page to see paired earnings and on-time service, inspect sample weeks, and share a scorecard. Sending the original report lets a recipient replay and verify all ten decisions in every week. [Verify and share a scorecard](https://arhaan2.github.io/evalsim-dispatch/addguard.html#own-agent)

## Reproduce a published policy

| CLI policy | Dispatcher |
|---|---|
| `rl` or `fit-73` | The preregistered continuation of fit 73 |
| `fit-101`, `fit-211` | Two independent training runs starting from the same parent |
| `candidate-101` | Exploratory 20% veto candidate from fit 101, rejected by the registered selection rule |
| `previous` | The original frozen switch-cost fit 73, before this study |
| `original` | The older move-recall dispatcher, seed 13 |
| `shortGate`, `flatRisk`, `planner` | Always short, constant penalty, and the rolling planner |

```sh
node tools/reserve.mjs --suite addguard --policy rl --split test --out continuation.json
node tools/reserve.mjs --suite addguard --policy previous --split test --out frozen-parent.json
node tools/reserve.mjs --suite addguard --policy candidate-101 --split test --out alternative.json
npm run audit:addguard
npm run audit:addguard:fit
npm run audit:addguard:ledgers
```

**Which extra moves were worth taking?** For recognition, put each policy on the same short-dispatcher route. At a disagreement, force each alternative once and follow short on both branches through the same freight and repairs until Friday. Negative long-minus-short credits mark a loss. Positive credits mark a profitable opportunity. Count loss vetoes among the parent’s additions and count profitable catches among all disagreements. The older move-recall policy is scored on the same opportunities to see whether the parent's original recall gain repeats.

**Did the fleet earn more?** Each policy operates both trucks for the entire week from its own resulting positions. Net credits deduct travel costs and 34 credits per missed contract. All ten scheduled contracts count toward on-time service. The release compares paired complete weeks within each freight family and reports 95% intervals alongside the counts. [Registered methods](https://github.com/Arhaan2/evalsim-dispatch/blob/f5529704964de0aae939a20c713ee16baecb3cfb/training/addguard/PROTOCOL.md) · [Training source](training/addguard/) · [MIT license](LICENSE)
