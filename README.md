# EvalSim DISPATCH

[Run the public simulator](https://arhaan2.github.io/evalsim-dispatch/) · [See the training evidence](https://arhaan2.github.io/evalsim-dispatch/#evidence) · [Inspect the language-model pilot](https://arhaan2.github.io/evalsim-dispatch/language-model.html)

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

“All orders on time” requires every committed unit to reach the correct destination by its deadline and all resource checks to pass. The two trained rows average three runs over the same 168 scenarios. The unfamiliar cases combine closure with demand surge, or change supplier connections while delaying inbound freight and cutting carrier capacity. The dispatcher handled those combinations most reliably.

The adaptive sampler uses recent operator failures to change how frequently each scenario family appears. Both mean validation curves first crossed the prespecified 85% all-orders threshold at 1,728 episodes. Adaptive practice crossed earlier in two individual seed pairs and tied the third. This experiment establishes learning in this world. A general training-speed advantage remains an open question. [Technical report](training/RESULTS.md) · [Protocol and reproduction](training/README.md) · [Every held-out outcome](docs/data/test-outcomes.json)

## A second agent selects the challenge

We also trained a scenario-selection policy to choose feasible disruptions and opening demand levels that exposed weaknesses in its operator. Each of six runs had a budget of exactly 32,768 operator calls. The learned challenger's operators achieved 75.2% complete success on a fresh test suite, compared with 77.4% under matched uniform sampling. Visitors can sample a scenario from the saved challenger. [Protocol, results and reproduction](training/challenger/README.md)

## What changed for a 4B language model

On twenty fresh scenarios, frozen Qwen3-4B delivered 467 of 657 units on time and completed zero shifts. A rank-four action-selection adapter trained on 72 balanced episodes delivered 542 units on time and completed two shifts. The dispatcher delivered 647 units on time and completed sixteen shifts. These are paired pilot measurements from one training seed. See the model's tool calls, including rejected bookings, in the [recorded comparison](https://arhaan2.github.io/evalsim-dispatch/language-model.html). [Per-case results](docs/data/llm/results.json) · [Model, method and local inference](training/language-model/README.md)

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
npm start
```

The first result audit replays 1,344 policy/scenario pairs and checks a feasible solution for each of 228 validation or final cases. The second audits the learned challenger and its 1,176 held-out outcomes. Both compare measured outcomes to public artifacts. See the [Qwen training and inference instructions](training/language-model/README.md) to reproduce the language-model track.

## Link from EvalSim

GitHub Pages serves the contents of `docs/` on `main`. Link directly to the stable project URL, or use an episode link to preselect the seed and both operators.

```html
<a href="https://arhaan2.github.io/evalsim-dispatch/">Try EvalSim DISPATCH</a>
```

[Example link to a route closure, seed 42](https://arhaan2.github.io/evalsim-dispatch/?scenario=route-closure&seed=42&operator=trained&compare=untrained)
