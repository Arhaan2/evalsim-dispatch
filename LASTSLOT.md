# Benchmark a dispatcher with one slot left

With one truck slot open and three offers still to come, would a fresh demand reading change which load you book? Try the same shift twice, buy the reading on one run and skip it on the other. The posted fee is taken directly from earnings. [Play the one-slot lab](https://arhaan2.github.io/evalsim-dispatch/lastslot.html) · [Replay a profitable purchase and a costly one](https://arhaan2.github.io/evalsim-dispatch/lastslot.html#slot-example)

The trained specialist earned more than the Bayesian planner on fresh hot-ending drops and cold-ending reversals. Its advantage over its own always-skip control was inconclusive on hot drops. On cold reversals, two purchases on the same tape cost 15 cents in total and added zero gross freight credits. The original interrupted-drop gains passed the retention test. [See all paired results](training/lastslot/)

## Run your own agent

Node.js 22 or later runs the JavaScript starter offline with no package installation. The tagged public repository includes the weights, fixed scenarios, reference policies and verifier under the MIT license.

```sh
git clone --branch lastslot-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite lastslot --split validation --policy ./examples/lastslot-agent.mjs
node tools/reserve.mjs --suite lastslot --split test --policy ./examples/lastslot-agent.mjs --out my-report.json
node tools/reserve.mjs --verify my-report.json
```

Upload the JSON to compare scores and replay an individual case in your browser. The report stays on your device. [Verify a report](https://arhaan2.github.io/evalsim-dispatch/lastslot.html#own-agent) · [JavaScript starter](examples/lastslot-agent.mjs) · [Python starter](examples/lastslot_agent.py)

```sh
node tools/reserve.mjs --suite lastslot --split test --out python.json -- python3 examples/lastslot_agent.py
node tools/reserve.mjs --suite lastslot --split retention --policy ./examples/lastslot-agent.mjs --out original.json
node tools/reserve.mjs --suite lastslot --split archive --policy ./examples/lastslot-agent.mjs --out archive.json
node tools/reserve.mjs --suite lastslot --split test --manifest > manifest.json
```

## What your agent sees

- Export a default JavaScript function taking `(observation, calls)`, or a `createPolicy()` factory for private per-shift memory. An external program reads one JSON Lines request per decision and writes one flushed response, such as `{"action":"skip"}`. Wave zero starts a new shift.
- At each freight offer, choose `accept` with a slot available or `pass`. You see the current signed price, public quote, prior calls, earlier offers and remaining slots. Each booking uses one of two slots. Future signed offers and the hidden ending stay concealed.
- After five offers, `observation.phase === "survey"`. The fee in `priceCents` has been visible since the opening. Buying reveals a count from 0 through 6 sampled from wave-six demand. Skipping leaves `reading` null. The free, delayed bulletin arrives at wave seven either way. Your agent and the planner may buy with any capacity. The released specialist buys only with exactly one slot.
- Final earnings in `netCents` equal signed `grossCents` minus `feeCents`. There are 100 cents per simulated credit. A signed load pays the same amount on paired replays, and buying the free survey still counts as a purchase.
- To test a custom price, import `runLastslotCase` from `evalsim-dispatch/lastslot` and call it with `{seed: 42, family: "cliff-drop-hot", priceCents: 17}` and your decision function. Any whole-cent price from 0 through 100 works. The official reports use the seven fixed prices below.

## Fixed public splits

| Split | Markets | Seed range | Freight tapes | Priced shifts |
|---|---|---|---:|---:|
| validation | Two development openings with both endings | 17200000–17200031 | 128 | 896 |
| test | Eight unseen openings with both endings | 17300000–17301023 | 16,384 | 114,688 |
| retention | Original interrupted drop | 17400000–17401023 | 1,024 | 7,168 |
| archive | Eight previous Tariff markets on new draws | 17500000–17500127 | 1,024 | 7,168 |

Every tape runs at 0, 5, 10, 25, 50, 75 and 100 cents. Primary comparisons average the six positive prices. Each of the two primary targets uses four unseen patterns and 1,024 seed clusters. Within each fresh opening, both endings have the same freight history when the survey is offered. Start with validation and freeze your policy before running the other splits.

## Reading the controls

| CLI policy | Decisions |
|---|---|
| `rl`, `rlNever`, `rlAlways` | Released one-slot specialist, same policy forced to skip, same policy forced to buy with one slot |
| `planner` | Independent price-aware Bayesian planner that chooses its own opening, acquisitions and bookings |
| `tariff`, `paid` | Previously released variable-price and one-credit learners evaluated at the posted price |
| `stochastic`, `booking`, `survey`, `rally`, `trust`, `drift`, `turns` | Historical controls with their original freight rules |

The primary score includes every offered shift. It tells you how a policy performs from the opening. A separate table on the desk measures the decision once there is exactly one slot. It places all three policies behind the same five offers and bookings using the previous Tariff opener. The skip comparison isolates the incremental return from purchasing. The independently acting planner also differs in how it books freight. Uncertainty intervals keep all endings and prices from each seed together. [Benchmark and matched one-slot table](https://arhaan2.github.io/evalsim-dispatch/lastslot.html#benchmark) · [Frozen training protocol](training/lastslot/protocol.mjs) · [License](LICENSE)
