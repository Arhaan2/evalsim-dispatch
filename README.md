# EvalSim DISPATCH

[Play the survey lab](https://arhaan2.github.io/evalsim-dispatch/survey.html) · [Benchmark your agent](SURVEY.md) · [Play the rally lab](https://arhaan2.github.io/evalsim-dispatch/rally.html) · [Play expert routing](https://arhaan2.github.io/evalsim-dispatch/trust.html) · [Play hot and cold closes](https://arhaan2.github.io/evalsim-dispatch/closes.html) · [Play Demand Turns](https://arhaan2.github.io/evalsim-dispatch/turns.html) · [Play Demand Shift](https://arhaan2.github.io/evalsim-dispatch/drift.html) · [Play Freight Reserve](https://arhaan2.github.io/evalsim-dispatch/reserve.html) · [Play Inventory Cutoff](https://arhaan2.github.io/evalsim-dispatch/cutoff.html) · [Explore Meridian Harbor](https://arhaan2.github.io/evalsim-dispatch/)

## Can the dispatcher recognize a misleading survey?

At wave seven a noisy survey arrives with information about wave five. The new agent estimates when that reading points toward the wrong closing market, then weighs the signed offer against the value of keeping a truck slot. Play matched shifts with the same posted odds and see how newer freight prices affect the decision. [Play the public lab](https://arhaan2.github.io/evalsim-dispatch/survey.html#matched-survey)

On 8,192 fresh shifts the new agent reduced the gap between confidence and ending accuracy from 30.8 percentage points to 3.3. It beat the planner by **0.84 credits per cold-ending reversal** and trailed it by **1.04 per hot-ending drop**. On the original interrupted drop the agent beat the planner by 8.88 credits and lost 2.95 against Rally, missing the one-credit retention target. A control using signed offers alone had comparable ending forecast error. [Read the results and controls](training/survey/)

Run your own Python or JavaScript policy on the same fresh, original and archived markets with the survey suite. [Benchmark guide](SURVEY.md)

## Is this rally a lasting demand turn?

Two dispatchers see the same early rally and have room to book only two loads. One shift ends hot and the other cools. The learned demand model updates its estimate after every signed offer and survey, then prices its remaining truck slots. The desk shows its probability of a hot finish, the value of booking now, and the distribution-aware planner’s decision. [Play both endings](https://arhaan2.github.io/evalsim-dispatch/rally.html)

On 8,192 fresh shifts the learned agent earned 0.64 more net credits per shift than the planner overall. It **trailed by 0.54 credits on cold-ending reversals and 1.87 on hot-ending drops**. On the original interrupted drop it beat the planner by 11.79 and retained the gains of all three earlier policies. At wave seven the model predicted the correct ending 52.1% of the time. A separately trained agent using the current offer and bulletin reached 61.7%. [Paired results and forecast accuracy](training/rally/)

```sh
node tools/reserve.mjs --suite rally --policy ./examples/reserve-agent.mjs --out rally.json
node tools/reserve.mjs --verify rally.json
```

Score your own agent on the fresh shifts, the original drop and the eight earlier Trust patterns. Upload the report to the public desk to replay its decisions locally. [Agent guide](RALLY.md)

## When should the dispatcher trust history?

The planner and the trained dispatchers sometimes disagree about booking a load. The new agent learns the value of booking versus passing at those decisions. Visitors can see the advice behind a booking and replay a matched shift. The study also trains a two-expert agent restricted to the planner and the Closes history policy.

The three-expert agent recovered the original interrupted-drop gains within the one-credit tolerance. It earned **2.54 more credits per shift than Closes** and **11.61 more than the distribution-aware planner** there. On fresh hot-ending drops, it gained 0.83 over Closes and trailed the planner by 0.66 (95% paired interval −1.16 to −0.15). The earlier reversal patterns kept a 0.69-credit lead over the planner on new seeds. On previously unseen reversal patterns the difference was −0.02 (−0.23 to +0.19). The two-expert agent met the hot-drop tolerance on fresh patterns and missed the original-drop recovery. [Read the paired results and inspect actual routing decisions](https://arhaan2.github.io/evalsim-dispatch/trust.html#benchmark)

```sh
node tools/reserve.mjs --suite trust --policy ./examples/reserve-agent.mjs --out trust.json
node tools/reserve.mjs --verify trust.json
```

Score your own agent on 8,192 fresh shifts, the original interrupted-drop test, or the eight earlier Closes markets on new seeds. [Agent guide](TRUST.md) · [Training results](training/trust/)

## Does history help when the market can finish hot or cold?

Two shifts open with the same freight offers. Demand then diverges, and your two truck slots can be worth very different amounts at closing. This benchmark crosses every new market opening with both endings. The released history agent and its no-history counterpart trained on identical freight tapes. Each competes against the distribution-aware planner on 2,048 fresh reversals and 2,048 fresh interrupted drops.

On fresh reversals the history agent earned **49.72 credits per shift**, the no-history agent **49.61** and the planner **49.11**. History added 0.70 credits on cold endings and cost 0.47 on hot endings. Across both endings its contribution was +0.11, with a paired 95% interval of −0.01 to +0.25. The history agent kept a 4.23-credit lead over the planner on fresh interrupted drops overall. Hot-ending drops favored the planner by 4.50. On the original interrupted-drop pattern it lost 2.46 credits against the earlier Turns agent, missing the retention target. [Results and paired intervals](training/closes/)

```sh
node tools/reserve.mjs --suite closes --policy ./examples/reserve-agent.mjs --out closes.json
node tools/reserve.mjs --verify closes.json
```

Try both endings in the browser, or score a JavaScript or Python agent on the full test and the three historical interrupted-drop patterns. [Agent guide](CLOSES.md) · [Study results](training/closes/)

## Can an agent recognize a turn in demand?

On 1,024 fresh shifts with early or late turns, the Turns policy earned **48.88 net credits per shift**, ahead of the previous Drift policy at **47.88** and the distribution-aware planner at **44.48**. On reversals alone it recovered 2.49 credits against Drift and trailed the planner by 0.69. It kept the original interrupted-drop advantage. On fresh rebounds its lead over the planner was 9.47 credits, but the measured range against Drift narrowly missed the study’s retention target.

Removing the agent’s history features and refitting it on the same freight offers increased average earnings by 0.54 credits. History helped on fresh rebounds. All four test markets cooled before closing, so the benchmark also rewards learning the shift clock. [Paired results and training method](training/turns/)

```sh
node tools/reserve.mjs --suite turns --policy ./examples/reserve-agent.mjs --out turns.json
node tools/reserve.mjs --verify turns.json
```

Use the same four test markets for your own JavaScript or Python agent, or replay the new policy on the original 768 Demand Shift cases. [Agent guide and pinned release](TURNS.md)

## When the demand forecast is wrong

The Demand Shift benchmark gives dispatchers a delayed market bulletin and the history of signed freight offers. Its original Q-learning policy trained on one-way steps and ramps. The test reserves three whole patterns that change direction during a shift.

On 768 synthetic test shifts, the learned policy earned **46.49 net credits per shift** and the original distribution-aware planner earned **46.22**. The paired difference was **+0.27** (95% interval −0.43 to +0.95). The pattern mattered: the learned policy lost 12.10 credits per reversal shift and gained 11.46 on interrupted drops. The original Reserve Q checkpoint, applied directly, earned 26.77. [Read the measured results](training/drift/)

```sh
node tools/reserve.mjs --suite drift --policy ./examples/reserve-agent.mjs --out drift.json
```

Replay a matched shift in the browser, verify a Python or JavaScript agent’s score locally, or inspect every case in the release. [Demand Shift agent guide](DRIFT.md)

## Should you save a truck for a better offer?

Eight freight offers arrive one at a time. Two loads can ship. Play a shift, then compare your bookings with a trained Q-learning policy and two dispatch planners on exactly the same offers.

On the 768-shift public test suite, the released policy earned **33.70 net credits per shift**. A planner that books against average future offers earned **30.21**. A planner that uses the full probability distribution earned **33.71**. RL’s largest gain over average-forecast planning was on surge shifts. All three policies tied on steady shifts. These are synthetic freight credits. [Results by demand pattern and training seed](training/reserve/)

```sh
node tools/reserve.mjs --policy ./examples/reserve-agent.mjs --out my-result.json
```

This scores your agent on the published shifts, re-runs all three reference policies and saves every decision. Open the result in the browser lab or verify it locally. JavaScript modules and external programs, including Python, use the same observations. [Agent interface and benchmark guide](RESERVE.md)

## Can your agent decide when to buy information?

One express truck leaves soon. Two customers need a delivery. Checking inventory costs a credit and a tick. Play a shift yourself, switch which yard has stock and see whether the same strategy works. Try the public planner and trained policies against the same shift, or plug in a local JavaScript agent.

```sh
node tools/lab.mjs --policy ./examples/earliest-deadline.mjs --seed 42 --pairs 16
```

The command runs a 64-shift comparison from this checkout using Node.js 22+. The original code is [MIT licensed](LICENSE) for commercial reuse. The [lab guide](LAB.md) covers the observation and action API, trace verification, self-hosting, third-party notices and a public channel to suggest a workflow for evaluation. The [CPU experiment](training/cutoff/) and [matched Qwen experiment](training/cutoff/qwen/) include their protocols, results and reproduction instructions.

On 192 held-out shifts the trained CPU policies and the observation-only planner delivered both orders in every case. Disabling the planner's inventory check reduced success to 144/192. Both curricula needed a median of 768 calls to sustain the validation target. On a common 96-case subset, frozen Qwen solved 22 shifts. Imitation solved 48, 47 and 48 across three training runs. Adding on-policy RL yielded 48 in each run. None of the Qwen checkpoints solved both halves of an uncertain pair. These measurements concern a two-order synthetic network. [Discuss a workflow with EvalSim](https://arhaan2.github.io/evalsim-site/#contact)

## Meridian Harbor

[![The Meridian Harbor map, with the East Yard to Old Town lane closed](docs/assets/dispatch-preview.png)](https://arhaan2.github.io/evalsim-dispatch/)

Close a freight lane or double a customer order. Run two dispatch policies in the same fictional harbor, pause at the decision where their plans diverge, and follow the goods to their destination. The verifier credits an order when the cargo arrives on time.

The interactive policies run directly in your browser. The exhibit also includes a separate experiment with a local 4B language model. The two experiments have different policies, training budgets and test suites.

## What the browser policy learned

We trained a 34-feature linear action policy with REINFORCE in a partially observed logistics simulation. Each of three training seeds gets 2,304 episodes under an adaptive sampler and 2,304 under a uniform sampler. The comparison uses fixed final checkpoints. Both samplers run on one CPU core per process. Every operator faces the same 168 held-out scenarios.

| Operator | All orders on time, 168 cases | All orders on time, 48 unfamiliar combinations | Mean on-time unit fraction, 168 cases |
| --- | ---: | ---: | ---: |
| Before training | 7.1% | 6.3% | 78.2% |
| Hand-coded dispatcher | 74.4% | **83.3%** | 96.7% |
| Uniform RL | **82.5%** | 61.8% | **98.1%** |
| Adaptive RL | 78.4% | 50.0% | 97.4% |
| Harbor planner, created after evaluating v1 | **100%** | **100%** | **100%** |

“All orders on time” requires every committed unit to reach the correct destination by its deadline and all resource checks to pass. The two trained rows average three runs over the same 168 scenarios. The unfamiliar cases combine closure with demand surge, or change supplier connections while delaying inbound freight and cutting carrier capacity. The later planner used public observations and knowledge of the v1 scenario structure. It also completed 700/700 additional shifts drawn from that generator. [Planner method](training/harbor-planner/) · [Frozen v1](https://github.com/Arhaan2/evalsim-dispatch/tree/harbor-v1.0.0)

The adaptive sampler uses recent operator failures to change how frequently each scenario family appears. Both mean validation curves first crossed the prespecified 85% all-orders threshold at 1,728 episodes. Adaptive practice crossed earlier in two individual seed pairs and tied the third. This experiment establishes learning in this world. A general training-speed advantage remains an open question. [Technical report](training/RESULTS.md) · [Protocol and reproduction](training/README.md) · [Every held-out outcome](docs/data/test-outcomes.json)

## A second agent selects the challenge

We also trained a scenario-selection policy to choose feasible disruptions and opening demand levels that exposed weaknesses in its operator. Each of six runs had a budget of exactly 32,768 operator calls. The learned challenger's operators achieved 75.2% complete success on a fresh test suite, compared with 77.4% under matched uniform sampling. Visitors can sample a scenario from the saved challenger. [Protocol, results and reproduction](training/challenger/README.md)

## What changed for a 4B language model

We trained two rank-four action-selection adapters on Qwen3-4B. Each received 72 complete episodes with a different practice schedule. Twenty new test scenarios were shared across all four operators.

| Operator | Complete shifts | Units delivered on time |
| --- | ---: | ---: |
| Frozen Qwen3-4B | 0 / 20 | 467 / 657 |
| Qwen, balanced practice | 2 / 20 | 542 / 657 |
| Qwen, adaptive practice | 1 / 20 | 509 / 657 |
| Dispatcher | 16 / 20 | 647 / 657 |

The balanced arm used 1,018 training tool calls and the adaptive arm used 951. Neither reached the prespecified 85% validation threshold. These are paired pilot measurements from one training seed. See the choices and rejected bookings in the [recorded comparison](https://arhaan2.github.io/evalsim-dispatch/language-model.html). [Balanced results](docs/data/llm/results.json) · [Adaptive results](docs/data/llm-curriculum/results.json) · [Model, method and local inference](training/language-model/README.md)

**Can the simulator teach an individual decision?** In a separate 60-episode experiment, we scored the consequences of 5,964 possible actions by asking what would happen if the dispatcher finished each alternative shift. Those training branches took another 70,100 simulated tool calls. On 21 previously unused test shifts, the new adapter completed 4, frozen Qwen completed 2, and the dispatcher completed 17. The adapter delivered 555 of 665 units on time, up from 468. Four shifts changed from failure to success, and two changed from success to failure. The test suite and method differ from the 20-case pilot above. [Decision-level results and paired cases](https://arhaan2.github.io/evalsim-dispatch/language-model.html#decision-credit) · [Training method](training/language-model/decision-credit/README.md)

## Inside the harbor

- Two suppliers, two warehouses and four customer destinations share limited inventory, transport capacity, shipping budget and time. Stock and capacity reports can go stale.
- The simulator exposes typed calls to inspect orders and stock, check suppliers and transport, reserve or release goods, purchase inventory, book a shipment, track freight, and advance the clock. The learning operator uses a finite observation-derived menu of those calls. Manual logistics features encode knowledge about quantities, deadlines and costs.
- Seeded external events follow the simulation clock. Every fourth tool call advances it, and the operator can also explicitly wait. The viewer can compare policies at the same decision index and inspect the tick reached by each one.
- The independent ledger verifier reconciles shipments, inventories, capacity, deadlines and spending. A separate full-information witness checks that every validation and final test case admits a feasible plan. Operators never see that plan.

[World, tools and verifier](docs/lib/world.js) · [Browser policy](docs/lib/policy.js) · [Small policy checkpoints](docs/data/checkpoints.json)

## Run and verify

Node.js 22 or later runs the simulator tests, benchmark and local preview with no npm dependencies or account. Open the local address printed by the preview.

```sh
npm test
npm run audit:results
npm run audit:models
npm run audit:labs
npm start
```

The first result audit replays 1,344 policy/scenario pairs and checks a feasible solution for each of 228 validation or final cases. The second audits the learned challenger and its 1,176 held-out outcomes. Both compare measured outcomes to public artifacts. See the [Qwen training and inference instructions](training/language-model/README.md) to reproduce the language-model track.

## Link from EvalSim

GitHub Pages serves the contents of `docs/` on `main`. Link directly to the stable project URL, or use an episode link to preselect the seed and both operators.

```html
<a href="https://arhaan2.github.io/evalsim-dispatch/">Try EvalSim DISPATCH</a>
```

[Example link to a route closure, seed 42](https://arhaan2.github.io/evalsim-dispatch/?scenario=route-closure&seed=42&operator=trained&compare=untrained)
