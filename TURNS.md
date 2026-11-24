# Benchmark an agent on demand turns

Every fresh market in this study closed cold. A follow-up pairs each opening with a hot and a cold finish and retrains both agents on those markets. [Hot and cold closes benchmark](CLOSES.md)

Two truck slots, eight expiring offers, and a market bulletin that trails demand. The earlier Drift policy often waited through a hot market and booked after it cooled. This study compares a newly trained policy with the released Drift policy and both public planners on identical freight offers. [Play Demand Turns](https://arhaan2.github.io/evalsim-dispatch/turns.html) · [Study results](training/turns/)

## Run the public benchmark

Use Node.js 22 or later. The tag pins the generator, both learned checkpoints, the test manifest and the scoring code. The JavaScript runner and Python starter use only their standard libraries.

```sh
git clone --branch turns-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite turns --policy ./examples/reserve-agent.mjs --out turns.json
node tools/reserve.mjs --verify turns.json
```

Replace the booking rule in the starter with your own. The default test scores **1,024 shifts**. Each of 256 seeds generates four market paths. The report lists average net credits, wins, ties, losses and paired intervals against each reference. It also groups cases into reversals and interrupted drops. Open the JSON on the public lab to replay your decisions against the other policies. [Compare your result](https://arhaan2.github.io/evalsim-dispatch/turns.html#own-agent)

For a Python agent, pass the program after `--`. The runner sends one JSON line per decision and accepts one flushed action in reply. Both interfaces receive the signed offer, current capacity, published forecasts, and all earlier signed offers and their original quotes. A policy can update on loads it passed. It receives no seed, pattern label, hidden demand probabilities or later bulletin. [Python starter](examples/reserve_agent.py) · [Observation fields](DRIFT.md#plug-in-your-agent)

```sh
node tools/reserve.mjs --suite turns --name my-python-agent --out my-turns.json -- python3 examples/reserve_agent.py
```

## Which shifts count?

| Split | Patterns | Cases |
| --- | --- | ---: |
| Training | Brief, sustained and rounded peaks and rebounds, seeds 9100000–9159999 | Six patterns across five fits |
| Validation | Mid-shift crest and rebound, seeds 9200000–9200063 | 128 |
| Test | Early crest, late crest, early rebound, late rebound, seeds 9300000–9300255 | 1,024 |
| Retention | The original interrupted-drop pattern, seeds 9400000–9400255 | 256 |

The four test demand trajectories are distinct from the training, validation and original Drift trajectories. Early and late crests test the reversal weakness. The two rebounds test transfer to new interrupted drops. The separate retention split reuses the original interrupted-drop generator with fresh seeds. It has its own score and stays out of the 1,024-shift average.

These synthetic markets share an eight-wave clock, two price-support schedules, and a cool final wave. A policy can benefit from learning when the market usually cools. To measure the contribution of observed history, the study also trains a comparison policy on the same market tapes using the current offer, bulletin, wave and capacity, with the history features removed.

```sh
node tools/reserve.mjs --suite turns --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --suite turns --split retention --policy ./examples/reserve-agent.mjs --out retention.json
node tools/reserve.mjs --suite turns --manifest > turns-manifest.json
```

Use validation while developing. Freeze your agent before measuring the test and retention splits. The public test becomes development data for any agent tuned to its scores.

## How to read the comparison

The main comparison pairs the new policy (`rl`) with the original distribution-aware planner (`stochastic`). That planner recomputes the value of a truck slot using every remaining offer’s published probabilities. The history-adjusted planner (`adaptive`) first corrects those probabilities using earlier forecast errors. The earlier learned policy (`drift`) uses the released Demand Shift weights.

The study declared three requirements before evaluation. The new policy must beat the distribution-aware planner overall, improve on the old policy on reversals, and retain the interrupted-drop gains on both fresh rebounds and the original pattern. Retention requires a positive advantage over the planner and a lower confidence bound above −1 credit per shift versus the old policy. That tolerance allows a small loss. The results give the actual difference as well. Intervals resample scenario seeds, keeping comparisons paired across policies and patterns.

The new policy gained **4.39 credits per shift** over the planner across all four fresh patterns (95% paired interval +3.54 to +5.21). On reversals it gained 2.49 against Drift and scored 0.69 below the planner. On fresh interrupted drops it gained 9.47 against the planner and scored 0.51 below Drift. Its interval against Drift reached −1.13, which missed the retention target. The original interrupted-drop guard passed. A policy refit without history earned 0.54 more credits overall and 0.63 fewer on fresh interrupted drops. [See every comparison and the five training runs](training/turns/)

To run a published policy or reproduce the fitted checkpoints and all scores:

```sh
node tools/reserve.mjs --suite turns --policy rl --out reference.json
npm run audit:turns
```

## Run the new agent on the original benchmark

On the earlier 768 Drift shifts, Turns earned **49.77** credits per shift, Drift earned **46.49**, and the planner earned **46.22**. Those shifts helped identify the original reversal weakness. Use the new test for evidence about transfer to fresh patterns. The command below scores the new policy on the original shifts and writes a standard Drift report.

```sh
node tools/reserve.mjs --suite drift --policy turns --out turns-on-drift.json
node tools/reserve.mjs --verify turns-on-drift.json
```

[Run the 768 shifts in your browser](https://arhaan2.github.io/evalsim-dispatch/drift.html#historical-run) · [Full protocol and results](training/turns/) · [MIT license](LICENSE)
