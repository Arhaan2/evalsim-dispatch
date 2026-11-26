# Benchmark a dispatcher on longer depot closures

It’s Wednesday afternoon. One depot is closed, and the truck you move tonight might still be at the wrong depot on Friday. The long-repair challenge asks a dispatcher to choose its moves from the freight and repair bulletins available at the time. Compare your own dispatcher with the rolling planner, the constant penalty and four learned-policy references on exactly the same weeks. [Play a decision](https://arhaan2.github.io/evalsim-dispatch/longrepair.html#play) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#longrepair)

## Run your first benchmark

Use Node.js 22 or newer. The Python example also needs Python 3. Both starters run locally with standard libraries.

```sh
git clone --branch longrepair-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite longrepair --split validation --policy ./examples/fleetweek-agent.mjs --out practice.json
node tools/reserve.mjs --verify practice.json
```

Replace the example with your own module and choose a name. Each earned or missed contract, loaded trip and empty move is recorded in the weekly outcome.

```sh
node tools/reserve.mjs --suite longrepair --split test --name "My fleet dispatcher" --policy ./examples/fleetweek-agent.mjs --out long-repair.json
node tools/reserve.mjs --verify long-repair.json
node tools/reserve.mjs --suite longrepair --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
```

Open your JSON report on the study page. The browser replays the actions locally and checks your weekly ledgers and comparisons. Share the compact scorecard link or download a standalone scorecard. A recipient can replay the linked examples. Send the original JSON as well if they want to verify the aggregate across all weeks. [Verify a report and get a scorecard](https://arhaan2.github.io/evalsim-dispatch/longrepair.html#own-agent)

## Write a policy

Export a default function `(observation, calls) => actionId` in a JavaScript ES module, or export a `createPolicy()` factory to keep per-week state. In a subprocess read one JSON line with `observation` and `calls`, then flush one response with the selected legal action ID, for example `{"action":"W|W"}`. Reset week-specific memory when `observation.epoch === 0`. Both trucks act together and each call has a one-second budget. [Full fleet interface](FLEETWEEK.md#agent-interface) · [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py)

Every due contract counts toward service. Missing one costs 34 credits. A closed depot can shelter a waiting truck or allow an empty departure. It cannot receive an empty truck or handle freight. The warning arrives one board before closure. If the repair continues into a second closed board, dispatchers receive an on-track or delayed update. The menu, public demand forecast, elapsed closure and published updates are available to all agents. The actual duration appears in the completed evaluation.

| Split | Weeks | Purpose |
|---|---:|---|
| `validation` | 256 | Develop on two freight schedules |
| `test` | 8,192 | Compare four unseen freight patterns and afternoon closure starts, with a mix tilted toward four- and five-half-day repairs |
| `clean` | 2,048 | Run the same four freight patterns with no depot closure |
| `archive` | 4,096 | Check the original double-return pattern on new closure-free weeks |

See the exact cases with `node tools/reserve.mjs --suite longrepair --split test --manifest`. The published cases are reusable. Disclose which splits you used for tuning when sharing results.

## Read the comparisons

| Reference | How it dispatches |
|---|---|
| `planner` | Rolling planner using public demand and repair probabilities |
| `flatRisk` | Published constant penalty on that planner's legal options |
| `closure` | Original RL dispatcher trained on repairs of one to three half-days |
| `rl` | Long-repair policy that can accept a closure proposal or stick with the constant penalty |
| `flatGate` | Same policy settings using the average learned returns at every disagreement |
| `shortGate` | Same learner and budget as the release, with only one-to-three-half-day repairs in the fitting stage and the same mixed calibration and selection weeks |

Earnings comparisons are net credits per week. Service differences are percentage points of the ten due contracts served on time. The study uses paired whole-week intervals and a zero-shortfall margin on service against each baseline. The archive tests the advantage inherited by following the historical constant policy whenever there is no closure. [Results, duration groups and fit comparisons](https://arhaan2.github.io/evalsim-dispatch/longrepair.html#results)

## Reproduce the published result

```sh
npm run audit:longrepair
npm run audit:longrepair:fit
npm run audit:longrepair:ledgers
```

The release includes the six checkpoints, deterministic simulator, case manifest, baseline action sequences, fitting source and scoring code. The first command refits and rebuilds the published numbers and page. The other checks independently examine training targets and reconstruct outcomes. [Protocol frozen before fitting](https://github.com/Arhaan2/evalsim-dispatch/blob/89e8312d6d50b36133efb6af8897ad372cd4e9c1/training/longrepair/PROTOCOL.md) · [Checkpoints locked before evaluation](https://github.com/Arhaan2/evalsim-dispatch/tree/e69c913bd1fc95b490029760f28a0c9ca1b1fc05/docs/data/longrepair) · [Training details](training/longrepair/) · [MIT license](LICENSE)

During the first export, the previous closure agent’s recorded path and the incident timing profile shared a JSON key. The release stores the path as `closurePolicy` and preserves `closure` for the timing profile. The public comparator name is `closure`. We reran the scorer with the locked checkpoints. All reported results, including example trajectories, were identical before and after the export correction when excluding the four reference-file hashes.
