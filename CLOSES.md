# Benchmark an agent on hot and cold closes

Eight freight offers arrive one at a time. You can book two. The last wave in the previous Demand Turns study always had low demand. Here each market opening has two continuations on the same seed. One ends with a high chance of an expensive offer and the other ends with a low chance. Both appear equally often in training, validation and test. [Play the public lab](https://arhaan2.github.io/evalsim-dispatch/closes.html)

## Run your agent

Use Node.js 22 or later. The tagged release includes the simulator, checkpoints, test cases and verifier. The runner works offline after cloning.

```sh
git clone --branch closes-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite closes --policy ./examples/reserve-agent.mjs --out closes.json
node tools/reserve.mjs --verify closes.json
```

Replace the rule in the JavaScript starter with your own. A module can export a default decision function or a `createPolicy()` factory for per-shift memory. For Python or another language, pass a local executable after `--`. Each line sent to the program contains the public observation and legal calls. Return one JSON line such as `{"action":"accept"}` and flush it. Wave zero starts a new shift. [JavaScript starter](examples/reserve-agent.mjs) · [Python starter](examples/reserve_agent.py) · [Observation fields](DRIFT.md#plug-in-your-agent)

```sh
node tools/reserve.mjs --suite closes --name my-python-agent --out my-closes.json -- python3 examples/reserve_agent.py
```

The default run scores 4,096 shifts. Your report contains every decision, mean credits and paired differences from the released history agent, its matched no-history model, the earlier Turns and Drift agents, and both planners. It breaks scores out by demand pattern and by closing conditions. Open your JSON file in the lab to replay and verify your result locally. [Compare your agent](https://arhaan2.github.io/evalsim-dispatch/closes.html#own-agent)

## Which markets count?

| Split | Markets per seed | Seeds | Shifts |
| --- | --- | --- | ---: |
| Training | Six openings, each with two endings | Five separate blocks within 10100000–10159999 | 144,000 sampled per fit |
| Validation | Two other openings, each with two endings | 10200000–10200127 | 512 |
| Test | Two new reversal openings and two new interrupted-drop openings, each with two endings | 10300000–10300511 | 4,096 |
| Retention | Three previous interrupted-drop markets | 10400000–10400511 | 1,536 |

The paired endings share earlier freight, the posted forecast, price supports and market randomness. A hot close increases the chance of a high-paying offer. An individual hot shift can still end with a low offer. The agent sees signed prices as they arrive and receives surveys with a two-wave delay. The seed, template and ending are absent from its observation. Remaining time and truck capacity still matter for booking. Each new opening gives the clock alone a 50% chance of naming its ending.

The retention split runs three original markets on fresh seeds. It uses the early and late rebounds from Demand Turns and the interrupted drop from Demand Shift. These older markets all close cold. Their scores are reported separately from the balanced test.

```sh
node tools/reserve.mjs --suite closes --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --suite closes --split retention --policy ./examples/reserve-agent.mjs --out retention.json
node tools/reserve.mjs --suite closes --manifest > closes-manifest.json
```

Use validation to develop an agent and freeze it before scoring test and retention. The public manifest lets anyone reproduce the cases. To make a generalization claim after tuning on public results, evaluate on another set of unseen patterns.

## Does history help?

The study fits two agents to identical freight histories. Both value a free slot using the wave, capacity, signed offer and complete public forecast. The history agent also uses earlier signed offers and bulletins. The primary comparison asks whether that agent beats both its no-history counterpart and the original distribution-aware planner on the same 2,048 fresh reversal shifts. A positive lower endpoint of the paired 95% interval is required for each comparison.

Retention requires a positive lower bound against the planner and a lower bound above −1 credit per shift against each previous RL agent. That check applies to fresh interrupted drops and to each historical drop market separately. Intervals resample entire seeds, keeping each market’s two endings and all operators together. They describe variation across these seeds for the selected patterns and checkpoint.

| Fresh shifts | History agent minus planner | History agent minus no-history agent |
| --- | ---: | ---: |
| Cold-ending reversals | +0.66 | +0.70 |
| Hot-ending reversals | +0.56 | −0.47 |
| Cold-ending interrupted drops | +12.95 | −0.07 |
| Hot-ending interrupted drops | −4.50 | +0.13 |

Across fresh reversals, the history agent’s lead over the planner was **+0.61 credits per shift** (95% interval +0.34 to +0.88). The matched no-history agent also beat the planner. Adding history changed earnings by **+0.11** (−0.01 to +0.25), leaving its contribution on reversals uncertain. Both the fresh interrupted-drop retention check and the two historical rebound checks passed. On the original interrupted-drop pattern the agent still beat the planner by 8.30, but earned 2.46 fewer credits than Turns and 2.90 fewer than Drift. The combined research target was unmet. [Frozen criteria](https://github.com/Arhaan2/evalsim-dispatch/tree/4898a8b/training/closes) · [Per-pattern intervals and all five fits](training/closes/)

```sh
node tools/reserve.mjs --suite closes --policy rl --out history.json
node tools/reserve.mjs --suite closes --policy ablated --out no-history.json
npm run audit:closes
```

[Training results and reproduction](training/closes/) · [Previous Demand Turns study](TURNS.md) · [MIT license](LICENSE)
