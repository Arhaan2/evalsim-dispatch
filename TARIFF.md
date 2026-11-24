# Benchmark an agent on variable survey prices

Two truck slots, eight freight offers and a single chance to buy information. The posted survey price is visible throughout the shift. Before wave six, buy a six-sample reading of current demand or skip it. The planner faces the same price, freight and potential reading. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/tariff.html) · [See results by price](https://arhaan2.github.io/evalsim-dispatch/tariff.html#benchmark)

Across 4,096 new freight tapes at seven prices, the trained agent bought 264 times at positive prices. It earned +0.02 net credits per run against the Bayesian planner on fresh hot-ending drops (paired 95% interval −0.07 to +0.09) and +0.03 on fresh cold reversals (−0.10 to +0.17). Both comparisons were inconclusive. It retained the historical interrupted-drop gains, earning 11.22 more than the legacy planner and 1.17 more than Booking there. [Full results and purchase rates](training/tariff/)

## Run your own agent

Use Node.js 22 or later. The tagged repository contains the simulator, models, reference policies, complete manifests and report verifier. The JavaScript starter runs offline without installing packages. The code and synthetic benchmark use the MIT license.

```sh
git clone --branch tariff-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite tariff --split validation --policy ./examples/tariff-agent.mjs
node tools/reserve.mjs --suite tariff --policy ./examples/tariff-agent.mjs --out tariff.json
node tools/reserve.mjs --verify tariff.json
```

Upload the JSON on the public desk to verify the charges and compare your agent with every reference. The browser replays each action against the fixed price, seed and family. [Verify a report](https://arhaan2.github.io/evalsim-dispatch/tariff.html#own-agent) · [JavaScript starter](examples/tariff-agent.mjs) · [Python starter](examples/tariff_agent.py)

```sh
node tools/reserve.mjs --suite tariff --out python-tariff.json -- python3 examples/tariff_agent.py
node tools/reserve.mjs --suite tariff --split retention --policy ./examples/tariff-agent.mjs --out original.json
node tools/reserve.mjs --suite tariff --split archive --policy ./examples/tariff-agent.mjs --out archive.json
node tools/reserve.mjs --suite tariff --split test --manifest > tariff-manifest.json
```

### Policy interface

A JavaScript module exports a default function taking `(observation, calls)` or a `createPolicy()` factory for private per-shift memory. A Python or other local program reads JSON Lines requests with the same fields and writes one flushed response such as `{"action":"skip"}`. The runner starts each priced shift at wave zero. Your policy decides all nine actions.

- The posted fee arrives as `priceCents` from the start. A credit has 100 cents. In the browser and `runTariffCase`, choose any whole-cent price from 0 through 100.
- In `phase === "survey"` the fifth offer has passed. The sixth signed price is still hidden. Buy or skip with the current slots and five observed freight prices. A buy immediately debits the posted fee. The same six-sample count becomes visible for the rest of the shift, including a legitimate reading of zero. Skipping leaves `reading` null.
- At freight decisions, return `accept` with an available slot or `pass`. The environment exposes the current signed offer, remaining public supports, bulletin and revealed history. The score reports signed freight in `grossCents`, cash paid in `feeCents`, and earnings after charges in `netCents`. A free purchase still counts as a buy.
- Use the complete priced manifest for comparisons. The browser and CLI report the count of individual tariffs tried, unique freight tapes and independent seed clusters. Start with validation, then freeze your policy before scoring on the other splits.

### Public splits

| Split | Markets | Seeds | Distinct tapes | Priced runs |
|---|---|---|---:|---:|
| validation | Two development openings, both endings | 16200000–16200031 | 128 | 896 |
| test | Four unseen openings, both endings | 16300000–16300511 | 4,096 | 28,672 |
| retention | Exact original interrupted drop | 16400000–16401023 | 1,024 | 7,168 |
| archive | Eight earlier Paid markets on new draws | 16500000–16500255 | 2,048 | 14,336 |

Every tape runs at 0, 5, 10, 25, 50, 75 and 100 cents. Each fresh stratum includes an opening where wave-six demand points toward the eventual ending and one where the market temporarily moves the other way. The survey samples current demand. The usual free, delayed bulletin arrives at wave seven.

### Reference policies

| CLI names | Decisions |
|---|---|
| rl, planner | Newly trained tariff-aware dispatcher and Bayesian planner; each can buy at the posted price |
| rlNever, rlAlways, plannerNever, plannerAlways | Same opening as the respective optional policy; force skip or buy at its survey window |
| paid | Prior one-credit learner, repricing its gate at the current fee with its original freight policy |
| stochastic, booking, survey, rally, trust, drift, turns | Historical policies with their published freight rules; each skips the survey |

For a custom run, import `runTariffCase` from `evalsim-dispatch/tariff` and pass a config such as `{seed: 42, priceCents: 17}` plus your decision function. Official reports use the complete seven-price schedule. [Training and results](training/tariff/) · [One-credit study](PAID.md) · [License](LICENSE)

The follow-up trains the purchase decision specifically for one remaining slot and compares it with always skipping on fresh, paired markets. [Play Last Slot](https://arhaan2.github.io/evalsim-dispatch/lastslot.html) · [Run the benchmark](LASTSLOT.md)
