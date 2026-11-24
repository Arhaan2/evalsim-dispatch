# Benchmark an agent that chooses whose booking advice to follow

One freight offer arrives per wave, and only two loads fit. The previous Closes agent beat the distribution-aware planner on reversals. On interrupted drops that ended hot, the planner earned 4.50 more credits per shift. On the original interrupted-drop market, two earlier history policies still did better. This study trains an agent to choose among booking recommendations as each offer arrives. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/trust.html) · [Previous study](CLOSES.md)

## Run the public benchmark

Use Node.js 22 or later. The tagged checkout contains the world, trained weights and verifier. After cloning, the JavaScript and Python starter agents run offline using their standard libraries.

```sh
git clone --branch trust-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite trust --policy ./examples/reserve-agent.mjs --out trust.json
node tools/reserve.mjs --verify trust.json
```

Replace the starter’s rule with your own, then open the resulting JSON in the lab. The browser verifies every decision on the same shifts and displays your paired differences by market and ending. Each JavaScript agent gets a public observation and the legal calls. For a policy with memory, export a `createPolicy()` factory to start fresh on each shift. An external program receives one JSON line per decision and returns one flushed reply such as `{"action":"pass"}`. Wave zero starts a new shift. [Compare your result](https://arhaan2.github.io/evalsim-dispatch/trust.html#own-agent) · [JavaScript starter](examples/reserve-agent.mjs) · [Python starter](examples/reserve_agent.py)

```sh
node tools/reserve.mjs --suite trust --name my-python-agent --out my-trust.json -- python3 examples/reserve_agent.py
```

## Matched shifts

| Evaluation split | Markets | Seeds | Shifts |
| --- | --- | --- | ---: |
| `validation` | Two development patterns, each with a hot and a cold ending | 11200000–11200127 | 512 |
| `test` | Two new interrupted-drop patterns and two new reversals, each with both endings | 11300000–11301023 | 8,192 |
| `retention` | The original interrupted-drop generator | 11400000–11401023 | 1,024 |
| `archive` | All eight previous Closes test schedules on new freight draws | 11500000–11501023 | 8,192 |

The two endings of a fresh pattern share an opening and the same market draws. A hot ending makes a high offer more likely. Either ending can produce a low signed offer. On every decision the agent sees its slots, the current signed price, the posted forecast and the history revealed so far. The harness keeps the seed, pattern, ending and later offers out of that observation. In the public CLI, each split is fixed and independently replayable. Develop on validation and freeze your own agent before evaluating it on the other splits. [Observation and action interface](DRIFT.md#plug-in-your-agent)

```sh
node tools/reserve.mjs --suite trust --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --suite trust --split retention --policy ./examples/reserve-agent.mjs --out retention.json
node tools/reserve.mjs --suite trust --split archive --policy ./examples/reserve-agent.mjs --out archive.json
node tools/reserve.mjs --suite trust --manifest > test-manifest.json
```

## Which policies can I compare?

| CLI policy | Booking advice available |
| --- | --- |
| `rl` | Learned choice among the distribution planner, Closes history RL and the earlier Drift history RL |
| `binary` | Separately trained choice between the planner and Closes history RL |
| `votes` | A matched three-expert router with reduced inputs. Its experts still use their ordinary observations. |
| `stochastic`, `adaptive` | The original distribution-aware and history-adjusted planners |
| `closes`, `drift`, `turns` | The three previously released RL checkpoints, each acting on its own |

Two experts can recommend the same action. When evaluating routing behavior, count a decision as informative only when at least one expert recommends booking and another recommends passing. A choice that agrees with two experts counts for both. Those percentages can add up to more than 100%.

## What counts as a repair?

Three tests were declared before fitting. Each compares the same freight offers across policies, using the lower endpoint of a paired 95% interval.

| Test | Required result |
| --- | --- |
| Hot-ending drops | Improve on Closes and stay within one credit per shift of the planner. An outright win over the planner requires a positive lower bound. |
| Original interrupted drop | Improve on Closes, beat the planner, and stay within one credit of both historical policies, Drift and Turns. |
| Reversals | Beat the planner on the equal mix of hot and cold endings and stay within one credit of Closes. |

The study repeats the hot-drop and reversal tests on the earlier Closes patterns using new seeds. Passing all five is the combined target. On a one-credit check the lower endpoint must exceed −1. Intervals resample whole seeds so that related endings, patterns and policy outcomes stay together. They reflect variation in freight draws for the fixed patterns and released training seed. [Prespecified criteria](https://github.com/Arhaan2/evalsim-dispatch/blob/9b13fa0/training/trust/protocol.mjs)

| Test | Three-expert router minus planner, net credits per shift [95% interval] | Result |
| --- | ---: | --- |
| Fresh hot-ending drops | −0.66 [−1.16, −0.15] | Gained 0.83 over Closes. Missed the one-credit planner tolerance. |
| Original interrupted drop, new seeds | +11.61 [+10.71, +12.49] | Recovered within tolerance of Drift and Turns. |
| Fresh reversals | −0.02 [−0.23, +0.19] | Stayed within tolerance of Closes. A win over the planner remains unproven. |
| Previous hot-ending drops, new seeds | −2.46 [−2.90, −1.99] | Improved on Closes and remained behind the planner. |
| Previous reversals, new seeds | +0.69 [+0.49, +0.89] | Retained the planner win within tolerance of Closes. |

On the original drop, the three-expert router gained 2.54 over Closes, scored 0.47 below Drift and 0.15 above Turns. The two-expert router met the fresh hot-drop tolerance (−0.42 against the planner, interval −0.90 to +0.10), but earned 2.93 fewer credits than Drift on the original drop. Neither router met the combined target. [Full results, routing decisions and controls](training/trust/)

```sh
node tools/reserve.mjs --suite trust --policy binary --out two-expert.json
npm run audit:trust
```

[Training protocol and results](training/trust/) · [MIT license](LICENSE)
