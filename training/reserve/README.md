# When should a dispatcher keep a carrier slot open?

Reserve gives a dispatcher two slots and eight sequential signed offers. An offer expires after one decision. Accepting earns its quoted net freight contribution and consumes a slot. Passing keeps that slot available for later bids. The objective is total net credits per shift. [Play Reserve](https://arhaan2.github.io/evalsim-dispatch/reserve.html) · [Run your own agent](../../RESERVE.md)

## What the learned policy earns

Each public operator saw the same signed offers. The point-forecast planner replans at every wave using the exact mean of each future offer. The stochastic planner knows the posted conditional probabilities and uses dynamic programming to value waiting for later observations. This gives it an expected-value-optimal policy under the simulation's independent demand law. An individual tape can still favor a different choice.

| Test family | Shifts | Released Q policy | Point planner | Stochastic planner | Q minus point, 95% paired interval | Q wins / ties / losses vs point |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Steady | 256 | 25.00 | 25.00 | 25.00 | 0.00 [0.00, 0.00] | 0 / 256 / 0 |
| Surge | 256 | 36.20 | 28.68 | 36.23 | +7.53 [+5.49, +9.61] | 125 / 43 / 88 |
| Volatile | 256 | 39.89 | 36.94 | 39.89 | +2.95 [+1.43, +4.64] | 112 / 60 / 84 |
| All | 768 | 33.70 | 30.21 | 33.71 | +3.49 [+2.48, +4.60] | 237 / 359 / 172 |

On steady shifts, every announced contribution is certain. On surge shifts, high-paying loads can appear late. In volatile shifts, opportunities with different spreads arrive throughout the shift. The point planner can commit a slot to an early load whose signed contribution exceeds the mean of a later offer. The learned policy can earn more by reserving capacity for the few later offers that pay especially well. On 172 test shifts, holding out earned less than the point planner's choices.

The released policy tied the stochastic planner on 761 shifts and earned one credit less on seven surge shifts. Its paired mean difference was −0.009 credits per shift (95% interval −0.016 to −0.003). A first-fit policy, which accepts the first two offers, averaged 21.30. These measurements support learning the value of waiting in this synthetic market. They establish no advantage over a planner that knows and uses its full demand law.

## What trained

Five separate exploration seeds generated batches of 36,000 shifts apiece, totaling 288,000 simulator calls per fit. Every shift drew a random acceptance propensity between 0.10 and 0.90. Exploration sampled legal calls at that propensity. Training retained each observed state, action, change in net contribution and next state. The tabular state consists of available slots, the current signed net contribution and the published sequence of future forecast ranges and probabilities. The learner gets no case seed, family ID, sampled future offer or action recommendation.

Finite-horizon fitted Q-learning works backward from the last wave. For each observed action, it estimates the mean of the observed one-step reward plus the largest learned legal next-action value. The discount factor is one. The released agent picks the legal action with the higher estimated return. An empty table accepts the first available offers. Training seed 13's final fit has 142 observed states with remaining capacity. Its validation mean moved from 21.59 untrained to 34.19 with 3,000 training seeds per family and 34.35 with 12,000.

| Training seed | Held-out mean net credits | Surge | Volatile |
| --- | ---: | ---: | ---: |
| 13 (released) | 33.70 | 36.20 | 39.89 |
| 37 | 33.81 | 36.09 | 40.34 |
| 73 | 33.66 | 36.09 | 39.89 |
| 101 | 33.91 | 35.96 | 40.76 |
| 211 | 33.36 | 34.91 | 40.18 |

All five scored 25 on steady shifts. Some fits earned more than the stochastic planner on these particular tapes. The stochastic planner optimizes expected contribution across draws.

## Frozen suite and uncertainty

The five fits used disjoint 12,000-seed blocks in 5100000–5159999. Each seed was crossed with all three families. Validation used 6100000–6100063 and the test suite used 7100000–7100255. The protocol chose seed 13's final fit before test evaluation. All runs were evaluated on the same test cases. Each shift's future tape is determined at initialization and stays the same across policies, even after their decisions diverge.

Intervals use 2,000 paired bootstrap draws of the 256 scenario seeds. Each draw keeps together the operators and families for a seed. These intervals quantify scenario sampling for the released checkpoint. The table of five fits separately shows training variability. The public suite tests new draws from the same six posted schedules, two per family. It does not test unseen schedules or live freight operations. Once you use the public test results to change your agent, use fresh seeds for a separate generalization estimate.

## Reproduction

The reference run used Node.js 24.18.0 on a macOS arm64 CPU without runtime dependencies. From the root of the source checkout:

```sh
node training/reserve/run.mjs --check
node --test test/reserve-policy.test.mjs
```

The audit refits every policy, verifies the ledger on each evaluation episode, and checks the released table, validation curves, all 768 per-shift outcomes, source fingerprint and matched intervals against the [published results](../../docs/data/reserve/results.json). To regenerate that file, run the script without `--check`. The [training protocol](protocol.mjs), [public case manifest and scoring statistics](../../docs/lib/reserve-policy.js), and [demand law and planners](../../docs/lib/reserve.js) ship with the benchmark.
