# Benchmark a dispatcher on delayed surveys

A freight dispatcher has two truck slots and eight chances to book. Two public surveys update the chance of a high offer. Each measures the market two waves earlier. An accurate reading of past demand can point the wrong way about the close. Play through the offers or bring your own dispatcher to the same fixed markets. [Open the public lab](https://arhaan2.github.io/evalsim-dispatch/survey.html) · [See the scorecard](https://arhaan2.github.io/evalsim-dispatch/survey.html#benchmark)

## Run your own agent

Use Node.js 22 or later. The tagged repository contains the public worlds, checkpoints, standard-library starters and verifier. The JavaScript example runs offline after cloning.

```sh
git clone --branch survey-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite survey --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --suite survey --policy ./examples/reserve-agent.mjs --out survey.json
node tools/reserve.mjs --verify survey.json
```

Replace the starter’s decision function with your own. A JavaScript module may export a default function or a `createPolicy()` factory for fresh memory each shift. It receives the current public observation and legal actions. An external program reads one JSON request per line and returns a flushed action, such as `{"action":"pass"}`. Wave zero starts a new shift. Open your report in the browser to verify its actions, credits and paired comparisons locally. [Compare your report](https://arhaan2.github.io/evalsim-dispatch/survey.html#own-agent) · [JavaScript starter](examples/reserve-agent.mjs) · [Python starter](examples/reserve_agent.py) · [Full observation interface](DRIFT.md#plug-in-your-agent)

```sh
node tools/reserve.mjs --suite survey --out python-survey.json -- python3 examples/reserve_agent.py
node tools/reserve.mjs --suite survey --split retention --policy ./examples/reserve-agent.mjs --out original.json
node tools/reserve.mjs --suite survey --split archive --policy ./examples/reserve-agent.mjs --out previous.json
node tools/reserve.mjs --suite survey --manifest > survey-manifest.json
```

## Which shifts will I face?

| Split | Markets | Seed range | Shifts |
|---|---|---|---:|
| validation | Two development openings with both endings | 13200000–13200127 | 512 |
| test | Four unseen openings with both endings | 13300000–13301023 | 8,192 |
| retention | The original interrupted-drop generator | 13400000–13401023 | 1,024 |
| archive | Eight previous Rally test patterns with new draws | 13500000–13501023 | 8,192 |

On the fresh set, every seed appears in every family. Twins share a market opening and random draws, then follow different demand paths. Each shift ends in a hot or cold regime; its signed prices remain stochastic. All agents receive the same information and face the same market tape for a given case. The observation contains earlier signed offers, current and earlier public bulletins, price supports and free slots. The runner withholds the family, ending and seed. Develop on validation, freeze the agent, then score the other three splits.

## Reference policies

| CLI name | Booking policy |
|---|---|
| rl | Estimates the risk that the latest bulletin points away from closing demand and prices the remaining slots |
| always | Uses the posted survey odds as the hot-ending forecast once a delayed survey is available |
| never | Uses signed offers and omits the survey from both the forecast and the booking policy |
| stochastic | Unchanged distribution-aware planner using the posted odds |
| rally, ablated | Previous Rally model and its current-only control |
| trust, closes, drift, turns | Earlier trained policies, each using its released checkpoint |
| adaptive | Earlier planner that updates its odds from signed-price surprises |

Score any reference by passing its CLI name to `--policy`. Installed consumers can import `runSurveyCase` from `evalsim-dispatch/survey`. The lab code and synthetic benchmark are MIT-licensed. [License](LICENSE) · [Previous Rally study](RALLY.md)

## Published results

The agent beat the planner by 0.84 credits on fresh cold reversals [0.56, 1.12] and trailed by 1.04 on hot drops [−1.37, −0.69]. It scored 45.38 on the original interrupted drop, ahead of the planner at 36.50 and below Rally at 48.33. This missed the one-credit retention target. Among the 6,715 wave-seven surveys with a direction, the model ranked misleading readings above aligned ones with AUROC 0.749 [0.736, 0.762]. A signed-offers-only control had similar closing forecast error. [Full training and results](training/survey/) · [Inspect two matched decisions](https://arhaan2.github.io/evalsim-dispatch/survey.html#matched-survey)
