# Benchmark an agent on changing demand

The [Demand Turns study](TURNS.md) follows up on this benchmark’s reversal result. It releases a new agent, tests fresh reversal and rebound patterns, and checks the original interrupted-drop pattern on new seeds.

Eight loads arrive one at a time and you can book two. Each offer states its actual net credits. The freight desk posts the possible values of future offers and an estimate of how likely the high value is. Demand changes during the shift, and the desk updates its forecast using a delayed, noisy survey. An agent can use signed offers to decide how much to trust the bulletin. [Play Demand Shift](https://arhaan2.github.io/evalsim-dispatch/drift.html)

## Run the same 768 shifts

Use Node.js 22 or later. No npm installation, account or API key is required. This tag pins the demand generator, test manifest, scoring code and all four reference policies.

```sh
git clone --branch drift-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite drift --policy ./examples/reserve-agent.mjs --out drift.json
node tools/reserve.mjs --verify drift.json
```

The runner prints credits per shift, paired differences with 95% intervals, and wins, ties and losses. The JSON contains your decisions and all reference scores for every shift. Open it in the browser lab to compare bookings wave by wave. Verification reconstructs the manifest, replays each action and checks every total. [Compare a local report](https://arhaan2.github.io/evalsim-dispatch/drift.html#own-agent)

## Plug in your agent

Replace the booking rule in the [JavaScript starter](examples/reserve-agent.mjs) or the [Python starter](examples/reserve_agent.py). A JavaScript default export receives `(observation, calls)` and returns `"accept"` or `"pass"`. It can be asynchronous. A stateful agent can export a synchronous `createPolicy()` that returns a fresh decision function for each shift.

```sh
node tools/reserve.mjs --suite drift --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --suite drift --name my-python-agent --out my-drift.json -- python3 examples/reserve_agent.py
```

The external-program interface sends one JSON line with `observation` and `calls` and expects one flushed JSON response such as `{"action":"pass"}`. A process persists across shifts. Clear any shift-specific memory on wave zero. Both interfaces run locally with your process permissions. [External agent protocol](RESERVE.md#bring-a-python-agent-or-another-executable)

| Public observation | What an agent can use |
| --- | --- |
| `offer`, `slots`, `net` | Current signed freight revenue, lane cost and net value, remaining slots, and credits already booked. |
| `wave`, `horizon`, `capacity` | Zero-based wave, eight offers per shift, two initial slots. |
| `quote` | Current offer’s published low and high net values, estimated `highChance` and quoted `mean`. |
| `forecast` | Remaining waves’ low and high values at the current bulletin probabilities. Later revisions become visible when issued. |
| `history` | Previous waves in order, with each signed `offer`, the `quote` then in effect and whether the high value occurred (`high`). Includes offers the agent passed. |
| `calls` | Available action IDs and labels. Accept uses one slot. Pass lets the offer expire. |

The runner withholds the seed, pattern name, underlying rates and future outcomes from the agent. Every agent on a given shift receives the same market tape. Its bookings change its capacity and score. Use only the public observation, reset between shifts and freeze your policy before testing. The code and cases are public, so a policy developed against these test scores needs another holdout for an independent transfer claim.

## What was held out

| Split | Demand patterns | Seeds |
| --- | --- | --- |
| Training | Step up, step down, ramp up, ramp down | 8100000–8159999 in disjoint blocks across five fits |
| Validation | Rising plateau, falling plateau | 8200000–8200063, 128 shifts |
| Public test | Reversal, double pulse, interrupted drop | 8300000–8300255, 768 shifts |

Each split uses different demand trajectories. After a shared neutral opening, the training and validation markets move in one direction. Each test pattern changes direction. The test keeps the same booking rules, price supports and forecast mechanism, isolating transfer to new demand trajectories. Each of the 256 test seeds appears in all three patterns and for every operator.

## Compare the references

| CLI name | Frozen policy |
| --- | --- |
| `rl` | The new fitted Q policy. It learned action values from rewards and observations on the four training patterns. |
| `stochastic` | The original Reserve distribution-aware planner. It re-solves the capacity problem each wave using the full posted probabilities. Forecast error can change the value of waiting. |
| `adaptive` | The same planner with a correction to future probabilities based on recent signed offers and their forecast errors. |
| `legacy` | The original Reserve Q checkpoint used directly, with its original action selection and fallback for unfamiliar observations. |

```sh
node tools/reserve.mjs --suite drift --manifest > drift-manifest.json
node tools/reserve.mjs --suite drift --policy stochastic
node tools/reserve.mjs --suite drift --policy rl --out drift-rl.json
npm run audit:drift
```

The audit retrains all five fits and checks their published scores. The primary comparison pairs the released RL policy with the original distribution-aware planner on identical offers. Its interval resamples whole seeds, keeping all three patterns together. Inspect by-pattern scores before using the equal-weight average to describe a particular market. [Results and training protocol](training/drift/) · [Machine-readable results](docs/data/drift/results.json) · [Original Reserve suite](RESERVE.md)

The original code is available under the [MIT license](LICENSE). [Discuss a workflow with EvalSim](https://arhaan2.github.io/evalsim-site/#contact)
