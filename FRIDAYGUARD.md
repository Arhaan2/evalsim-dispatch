# Benchmark a dispatcher on Friday deliveries

Two trucks work ten half-days across three depots. A depot gives one board’s notice before a closure. Can your dispatcher serve more Friday contracts than positioning fit 211 and earn more all week than the rolling planner? The scorecard also checks how many contracts and credits it keeps from positioning fit 101. [Open the study](https://arhaan2.github.io/evalsim-dispatch/fridayguard.html#results) · [Compare the earlier positioning policies](https://arhaan2.github.io/evalsim-dispatch/preposition.html#independent-fits)

## Try your own agent

Use Node.js 22 or newer. The release includes the simulator, reference policies, case banks and starters. The JavaScript starter needs no package installation.

```sh
git clone --branch fridayguard-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite fridayguard --split validation --policy ./examples/fleetweek-agent.mjs --name "My fleet" --out practice.json
node tools/reserve.mjs --verify practice.json
```

Replace the starter with your JavaScript module. Export a default function taking `(observation, legalActions)` and returning a legal joint-action ID, or export a `createPolicy()` factory for per-week state. A Python agent reads a JSON line per decision and flushes one legal ID. Reset any per-week memory at epoch zero. Agents get one second per decision and may act on all ten boards. [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py) · [Observation and action format](FLEETWEEK.md#agent-interface)

```sh
node tools/reserve.mjs --suite fridayguard --split test --out my-fridays.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify my-fridays.json
```

The CLI prints Friday saves and misses against each reference, paired uncertainty, weekly service and net credits. Load the JSON into the study to verify your route and generate a shareable scorecard. The public bank makes the comparison reproducible. Disclose which weeks you used for development when reporting a score. [Verify and share your report](https://arhaan2.github.io/evalsim-dispatch/fridayguard.html#own-agent)

## Compare like for like

| Split | Weeks | Conditions |
| --- | ---: | --- |
| `validation` | 256 | Two development schedules, with closure warnings |
| `test` | 32,768 | Eight fresh schedules, warnings on Tuesday, Wednesday or Thursday morning |
| `clean` | 4,096 | Same eight schedules, other seeds, open depots |
| `archive` | 4,096 | New open-depot weeks on the original double-return schedule |

Friday AM and PM each have one signed contract. A save means the new dispatcher served the same contract another dispatcher missed. A newly missed contract counts in the opposite direction. All ten signed contracts count toward weekly service. Weekly earnings include empty and loaded trip costs and 34 credits for each missed contract. Paired intervals resample whole weeks within each schedule.

Use `--manifest` with the suite and split to list each case. Use `--policy previous` for frozen positioning fit 101, `--policy fit211` for frozen positioning fit 211, `--policy frozen73` for original switch-cost fit 73 and `--policy planner` for the rolling planner. The three **newly trained** fits use the hyphenated identifiers `fit-73`, `fit-101` and `fit-211`. The default `rl` is the preregistered primary, fit-73.

```sh
node tools/reserve.mjs --suite fridayguard --split test --policy rl --out primary.json
node tools/reserve.mjs --suite fridayguard --split test --policy fit211 --out frozen-211.json
npm run audit:fridayguard:fits
npm run audit:fridayguard:study
npm run audit:fridayguard:ledgers
```

The 39 historical Friday misses and 35 historical saves came from the prior public benchmark and are reported separately. [Historical replay](https://arhaan2.github.io/evalsim-dispatch/fridayguard.html#historical) · [Registered tests and training design](training/fridayguard/PROTOCOL.md) · [MIT license](LICENSE)
