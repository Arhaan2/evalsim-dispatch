# Benchmark a dispatcher that can buy a fresh survey

Before wave six, choose whether to spend one credit for a new reading of freight demand. The price, purchase time, possible readings and freight tape are the same for your agent and the reference policies. Net credits include the fee. [Play the desk](https://arhaan2.github.io/evalsim-dispatch/paid.html) · [Public scorecard](https://arhaan2.github.io/evalsim-dispatch/paid.html#benchmark)

At one credit, both the trained agent and the survey-aware planner skipped all 8,192 fresh surveys. When the agent was forced to buy, it changed 185 booking sequences and lost 1.04 net credits per shift. Against the survey-aware planner it earned +0.02 on fresh hot-ending drops (paired 95% interval −0.02 to +0.06) and −0.21 on fresh cold-ending reversals (−0.33 to −0.09). It recovered the historical interrupted-drop gains and finished 0.01 behind the survey-aware planner there (−0.08 to +0.05). [Full results and controls](training/paid/)

## Run your own agent

The MIT-licensed checkout includes the market generators, reference policies, learned checkpoint, report verifier and two starter agents. The JavaScript benchmark needs Node.js 22 or later and runs offline.

```sh
git clone --branch paid-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite paid --split validation --policy ./examples/paid-agent.mjs
node tools/reserve.mjs --suite paid --policy ./examples/paid-agent.mjs --out paid.json
node tools/reserve.mjs --verify paid.json
```

Upload the JSON on the public desk to inspect your nine decisions and fee-adjusted earnings. A local browser worker verifies the manifest, actions, survey reading, gross credits, fee and all reference comparisons. [Upload your report](https://arhaan2.github.io/evalsim-dispatch/paid.html#own-agent)

The JavaScript module can export a default decision function or a per-shift `createPolicy()` factory. The runner passes `(observation, calls)`. At `phase === "survey"` the sixth signed offer is still hidden, `wave === 5`, and the available calls are `buy` and `skip`. A buy incurs the posted `surveyFee` immediately. The next observation reveals the sixth signed offer either way. Buyers also see an integer `reading` from 0 through 6, including zero as a valid reading. A skip leaves it null. The remaining freight actions are `accept` when a slot is open, or `pass`. The reported net equals signed freight credits less the survey fee.

A Python agent can return one flushed JSON action per input line. The starter uses the same rule in both languages. [JavaScript starter](examples/paid-agent.mjs) · [Python starter](examples/paid_agent.py)

```sh
node tools/reserve.mjs --suite paid --out python-paid.json -- python3 examples/paid_agent.py
node tools/reserve.mjs --suite paid --split retention --policy ./examples/paid-agent.mjs --out original.json
node tools/reserve.mjs --suite paid --split archive --policy ./examples/paid-agent.mjs --out booking-markets.json
node tools/reserve.mjs --suite paid --split surveyArchive --policy ./examples/paid-agent.mjs --out survey-markets.json
node tools/reserve.mjs --suite paid --split test --manifest
```

## Public markets

| Split | Fixed market families | Seeds | Shifts |
|---|---|---|---:|
| validation | Two development openings, both endings | 15200000–15200127 | 512 |
| test | Four new openings, both endings | 15300000–15301023 | 8,192 |
| retention | Exact original interrupted-drop generator | 15400000–15401023 | 1,024 |
| archive | Eight Booking test families, new draws | 15500000–15501023 | 8,192 |
| surveyArchive | Eight Survey test families, new draws | 15600000–15601023 | 8,192 |

Each reading counts high responses from six samples of the wave-six high-offer probability. The reading stream is separate from freight draws. The reading measures the current market. The new test includes hot-ending drops whose wave-six market is still cold, and cold reversals whose wave-six rally is brief. A free delayed bulletin still arrives at wave seven. No public observation includes a market name, ending, seed or future signed price. Use validation during development and freeze your policy before scoring on the other splits.

## Reference policies

| Name | Decisions |
|---|---|
| rl, planner | Learned dispatcher and Bayesian distribution-aware planner, each with the one-credit buy option |
| rlNever, rlAlways | Force the learned dispatcher to skip or buy at the gate |
| plannerNever, plannerAlways | Force the planner to skip or buy at the gate |
| rlFree, plannerFree | Separately scored zero-fee counterfactuals included in every report |
| stochastic | Previous stochastic planner, using the posted bulletin and skipping the new survey |
| booking, survey, rally, trust, drift, turns | Frozen historical policies that skip the purchase and book using their original rules |

Free controls see a zero fee. The planner accounts for the tariff before wave six. The released learner keeps its one-credit training tables and reprices the purchase at the gate. Entrants and all other references pay the official fee. Two policies on the same manifest may reach the purchase with different truck capacity. [Method and paired results](training/paid/) · [Previous Booking study](BOOKING.md) · [License](LICENSE)
