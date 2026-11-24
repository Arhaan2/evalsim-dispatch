# Benchmark early freight bookings

Two trucks can accept two of the eight offers in a shift. The final survey arrives at wave seven. The new agent learns when to book and when to wait during the first six waves. The released Survey agent handles the last two decisions with whatever capacity the early policy leaves. [Play the desk](https://arhaan2.github.io/evalsim-dispatch/booking.html) · [Open the scorecard](https://arhaan2.github.io/evalsim-dispatch/booking.html#benchmark)

## What the published agent earned

| Market | Shifts | Mean advantage over the planner in credits | Paired 95% interval |
|---|---:|---:|---|
| All fresh endings | 8,192 | +0.72 | +0.54 to +0.90 |
| Fresh hot-ending drops | 2,048 | −1.39 | −1.70 to −1.10 |
| Fresh cold-ending reversals | 2,048 | +0.26 | +0.02 to +0.50 |
| Original interrupted drop | 1,024 | +10.02 | +9.19 to +10.87 |
| Earlier cold-ending reversals, new seeds | 2,048 | +0.26 | −0.06 to +0.58 |

The original-drop score improved by 1.50 credits over Survey and remained 2.04 behind Rally. The recovery target allowed a one-credit shortfall. All five fitted agents trailed the planner on fresh hot-ending drops. [Read the frozen targets, controls and decision audit](training/booking/)

## Run your own agent

Use Node.js 22 or later. The tagged checkout contains the synthetic markets, trained checkpoints, public references and report verifier. The JavaScript starter runs offline without installing packages.

```sh
git clone --branch booking-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite booking --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --suite booking --policy ./examples/reserve-agent.mjs --out booking.json
node tools/reserve.mjs --verify booking.json
```

A JavaScript agent exports a default decision function or a per-shift `createPolicy()` factory. The runner supplies the current signed offer, public forecast, holdings, revealed history and legal actions. A Python or other external program can read JSON requests one line at a time and return a flushed action such as `{"action":"pass"}`. Wave zero starts a new shift. Your policy controls all eight decisions. Upload a saved report to the desk to replay the calls and check the paired scores locally. [Upload a report](https://arhaan2.github.io/evalsim-dispatch/booking.html#own-agent) · [JavaScript starter](examples/reserve-agent.mjs) · [Python starter](examples/reserve_agent.py) · [Agent interface](DRIFT.md#plug-in-your-agent)

```sh
node tools/reserve.mjs --suite booking --out booking-python.json -- python3 examples/reserve_agent.py
node tools/reserve.mjs --suite booking --split retention --policy ./examples/reserve-agent.mjs --out original.json
node tools/reserve.mjs --suite booking --split archive --policy ./examples/reserve-agent.mjs --out previous.json
node tools/reserve.mjs --suite booking --split test --manifest > booking-manifest.json
```

## Public splits

| Split | Markets | Seeds | Shifts |
|---|---|---|---:|
| validation | Two development openings, both endings | 14200000–14200127 | 512 |
| test | Four unseen openings, both endings | 14300000–14301023 | 8,192 |
| retention | The exact original interrupted-drop generator | 14400000–14401023 | 1,024 |
| archive | Prior Survey test families with new freight draws | 14500000–14501023 | 8,192 |

Each fresh reversal or interrupted drop has a matched twin with the same opening and random draws. The two endings change the odds of high freight offers. The public forecast is updated at waves four and seven using a noisy, two-wave-old survey. The agent can see the next price supports, earlier signed prices and posted odds. The harness keeps the seed, family, ending and unrevealed prices out of the observation. Use validation during development, then freeze your own policy before evaluating it on the other splits.

## Compare booking policies

| CLI policy | Decision rule |
|---|---|
| rl | Early action values selected on training-only markets; uses the existing Survey policy on waves seven and eight |
| equal | Same early return-learning procedure with equal weight per fitting shift; same Survey continuation |
| earlyPlanner, earlyRally | Use the distribution-aware planner or Rally for six decisions, then hand the remaining slots to Survey |
| stochastic, survey, rally | The unchanged full-shift distribution-aware planner and the two previous agents |
| trust, closes, drift, turns, adaptive | Earlier published agents and the history-adjusted planner |
| always, never, ablated | Earlier Survey controls that follow or ignore the bulletin, and the earlier current-only Rally control |

Pass a reference name with `--policy`, or import `runBookingCase` from `evalsim-dispatch/booking` in your own project. The lab code and synthetic benchmark are available under the MIT license. [License](LICENSE) · [Prior study](SURVEY.md)
