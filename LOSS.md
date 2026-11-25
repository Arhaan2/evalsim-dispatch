# Benchmark an overnight fleet dispatcher

On Monday through Thursday night, one dispatcher proposes moving an empty truck and the rolling planner would make a different call. The released agent estimates the probability that accepting the proposal leaves the fleet with fewer credits at Friday close. Explore an actual decision or run your own agent over the complete five-day week. [Play a decision](https://arhaan2.github.io/evalsim-dispatch/loss.html#replays) · [Study results](https://arhaan2.github.io/evalsim-dispatch/loss.html#results)

The fleet agent earned **0.576 more net credits per week than the rolling planner** on 8,192 weeks from four unseen schedules (paired 95% interval +0.086 to +1.056). It also delivered a higher on-time rate than both the planner (+0.184 percentage points, +0.100 to +0.271) and the published constant penalty (+0.046 points, +0.010 to +0.083). The constant penalty earned 0.122 more credits per week on average. The agent-minus-penalty interval was −0.348 to +0.100, leaving that earnings comparison open. On 4,096 new double-return weeks, the agent kept its earnings win over the planner at **+2.111 credits per week** (+1.339 to +2.896). [Measured comparisons](https://arhaan2.github.io/evalsim-dispatch/loss.html#results)

## Run your agent

You need Node.js 22 or newer. The Python example also requires Python 3. Both starters use the standard library.

```sh
git clone --branch loss-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite loss --split validation --policy ./examples/fleetweek-agent.mjs --out validation.json
node tools/reserve.mjs --suite loss --split test --policy ./examples/fleetweek-agent.mjs --out fresh.json
node tools/reserve.mjs --suite loss --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
node tools/reserve.mjs --verify fresh.json
```

Replace the example path with your own agent. A JavaScript policy receives the public observation and legal joint actions and returns an action ID. A policy with memory can export a per-week `createPolicy()` factory. A Python subprocess receives one JSON object per line with `observation` and `calls`, and must flush a response such as `{"action":"W|W"}`. Reset week-specific state on epoch zero. Your policy can choose any legal joint action on all ten boards. The decision budget is one second. [Fleet API and action rules](FLEETWEEK.md#agent-interface)

Start with the 256 development weeks. Then score the same 8,192 fresh weeks and 4,096 double-return weeks as the released agent. Each dispatcher gets identical freight and deadlines. Run `node tools/reserve.mjs --suite loss --split test --manifest` to inspect the cases. Disclose any tuning on public test cases when sharing results. Open the report in the study page to verify your ledger and replay your actions. [Verify a report](https://arhaan2.github.io/evalsim-dispatch/loss.html#own-agent)

## Read the comparisons

| Policy key | Dispatcher |
|---|---|
| rl | Released fit 13 using the learned probability of losing to the planner |
| planner | Rolling planner |
| flatRisk | Previous study's published constant downside penalty, with its original weights and settings |
| constantLoss | New dispatcher with every loss probability replaced by the same calibration-set loss frequency |
| uncertainty | Previous dispatcher with its learned downside penalty |
| override | Original overnight override agent whose proposals the release can accept or decline |
| previous | Original fleet RL agent with unrestricted dispatch actions |

Net credits include loaded and empty travel and missed-contract penalties. Service is the share of the ten due contracts delivered on time. Each comparison runs both dispatchers to Friday. To score a loss prediction, both branches follow the published constant-penalty dispatcher after the initial decision. To show the impact of a decision in the release, both branches follow the released policy afterward. [Paired replays](https://arhaan2.github.io/evalsim-dispatch/loss.html#replays)

## Reproduce the release

```sh
npm run audit:loss
npm run audit:loss:ledgers
npm run audit:loss:fit
```

The commands refit the five checkpoints, reproduce the benchmark and results page, independently replay the ledgers and check the training evidence. [Pre-training protocol](https://github.com/Arhaan2/evalsim-dispatch/blob/1098a8c37dce98cfc65bf8e7a5cadde8f207c978/training/loss/PROTOCOL.md) · [Checkpoints locked before scoring](https://github.com/Arhaan2/evalsim-dispatch/tree/e6c8e6be7778f6d117a2b3412821ad12924ec6b6/docs/data/loss) · [Training report](training/loss/) · [Results JSON](docs/data/loss/results.json) · [Previous study](UNCERTAINTY.md) · [MIT license](LICENSE)
