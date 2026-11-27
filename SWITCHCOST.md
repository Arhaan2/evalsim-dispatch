# Benchmark a fleet agent on costly switches

Your two trucks have ten half-days to deliver freight across three depots. When a depot closes, two trained dispatchers sometimes disagree on whether to wait or reposition a truck. The previous study took extra long-repair moves to catch more profitable opportunities. This study asks which of those switches a dispatcher can decline without missing the ones that pay. Your own agent can take any legal action on every board. [Play a decision](https://arhaan2.github.io/evalsim-dispatch/switchcost.html#play) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#switchcost)

## Try a starter

Use Node.js 22 or newer. The tagged checkout contains the simulator, fitted policies and fixed case banks. Start with 256 validation weeks.

```sh
git clone --branch switchcost-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite switchcost --split validation --policy ./examples/fleetweek-agent.mjs --name "My dispatcher" --out practice.json
node tools/reserve.mjs --verify practice.json
```

Replace the starter with a JavaScript module exporting `(observation, calls) => actionId`, or a `createPolicy()` factory for per-week memory. A Python agent reads one observation and legal action menu per JSON line on standard input and flushes one legal joint action, such as `{"action":"W|W"}`. Reset week-specific memory at epoch zero. The public board includes positions, freight, repair notices and forecasts. A decision has a one-second budget. [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py) · [Agent interface](FLEETWEEK.md#agent-interface)

## Run and share a benchmark

```sh
node tools/reserve.mjs --suite switchcost --split test --out fresh.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify fresh.json
node tools/reserve.mjs --suite switchcost --split archive --policy ./examples/fleetweek-agent.mjs --out double-return.json
node tools/reserve.mjs --verify double-return.json
```

Open the JSON report on the study page to compare whole-week scores, replay moves and create a shareable scorecard. A scorecard link includes sample weeks. Share the original JSON for a complete replay and independent verification. [Open the scorecard verifier](https://arhaan2.github.io/evalsim-dispatch/switchcost.html#own-agent)

| Split | Weeks | Freight and repair conditions |
|---|---:|---|
| `validation` | 256 | Two practice schedules with repairs |
| `test` | 32,768 | Eight unseen schedules, afternoon closures, repairs lasting one to five half-days |
| `clean` | 4,096 | The same eight schedules on different seeds with open depots |
| `archive` | 4,096 | New draws from the original double-return schedule with open depots |

Use `node tools/reserve.mjs --suite switchcost --split test --manifest` to list the weekly cases. Develop on validation and disclose which public weeks you used when sharing your results.

## Read the comparisons

**Costly switches and recall.** Follow the short dispatcher and score both policies at every disagreement. Force each first action, then follow short on identical future freight through Friday. A switch is costly if the long option earns fewer net credits and profitable if it earns more. The study counts losses avoided, new losses taken, profitable choices given up and profitable replacements. Recall is the share of all profitable alternatives taken. The predecessor is scored again on exactly the same boards. The 51 losses from its historical study do not enter the training or test data here. [Switch outcomes](https://arhaan2.github.io/evalsim-dispatch/switchcost.html#detection)

**Earnings and service.** For the weekly benchmark, let every policy make all ten decisions from its own truck positions. Net credits deduct travel costs and 34 credits per missed contract. All ten contracted deadlines count for on-time service, including those affected by closure. Compare with always following the short-repair expert, the constant penalty, the rolling planner and the frozen predecessor. [Fresh-week and double-return results](https://arhaan2.github.io/evalsim-dispatch/switchcost.html#results)

## Reproduce the published agent

The official agent is `--policy rl`, the predesignated seed-13 fit. You can also submit any of the five frozen fits as the agent under test. Seed 73 was the only fit that selected a rule to veto and add switches during training. All eight reference policies and all benchmark weeks stay fixed when you run it.

```sh
node tools/reserve.mjs --suite switchcost --split test --policy fit-73 --out fit-73.json
node tools/reserve.mjs --verify fit-73.json
```

The other published policies are `fit-13`, `fit-37`, `fit-101` and `fit-211`. To reproduce and audit the experiment from source, run:

```sh
npm run audit:switchcost
npm run audit:switchcost:fit
npm run audit:switchcost:ledgers
```

These commands refit the five models, reproduce the study data and rendered results, and independently audit the fits and trajectories. [Registered criteria](https://github.com/Arhaan2/evalsim-dispatch/blob/2fbbab35f3f31e2a76a48797213d39f93575f800/training/switchcost/PROTOCOL.md) · [Checkpoints locked before testing](https://github.com/Arhaan2/evalsim-dispatch/tree/6e621377ec556ead68fdc7049f992360eee6361e/docs/data/switchcost) · [Training source](training/switchcost/) · [MIT license](LICENSE)
