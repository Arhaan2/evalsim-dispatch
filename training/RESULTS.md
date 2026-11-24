# DISPATCH experiment results

Uniform reinforcement learning completed all four orders on time in **82.5%** of held-out shifts, averaged across three training seeds. The adaptive curriculum reached **78.4%**, the hand-written dispatcher **74.4%**, and the untrained policy **7.1%**. Each trained operator practiced for 2,304 episodes. All four policies used the same public observations and candidate tool calls.

## Final performance

There were 168 distinct test cases, with 24 seeds in each of seven scenario families. The first five families appeared during training with different seeds. The final two introduce previously unseen disruption combinations. Under network shift, supplier connections, demand and deadlines change as well.

| Operator | All commitments met | On-time units | Spend per shift | Tool calls per shift | Success on familiar families | Success on new combinations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Untrained | 7.1% | 78.2% | 82.7 | 22.6 | 7.5% | 6.3% |
| Hand-written dispatcher | 74.4% | 96.7% | 76.2 | 13.8 | 70.8% | **83.3%** |
| Uniform RL | **82.5%** | **98.1%** | 73.7 | 15.9 | **90.8%** | 61.8% |
| Adaptive RL | 78.4% | 97.4% | 71.3 | 16.0 | 89.7% | 50.0% |

An episode succeeds only when the ledger verifies that every commitment arrived by its deadline and all resource constraints reconcile. On-time units measures each shift's share of committed units delivered on time. Every run had zero ledger violations. The simulator rejects calls that exceed available resources, and those calls still consume decision budget. Spending includes incomplete shifts, so lower average spending alone cannot establish cost efficiency.

The UI uses the first training seed by design. That specific adaptive checkpoint completed 124 of the 168 cases (73.8%). The three adaptive checkpoints ranged from 73.8% to 83.3%. The three uniform checkpoints ranged from 76.2% to 86.3%. The table averages all three seeds. Each seed faces the same 168 cases.

## Curriculum and time to competence

The threshold set before training was 85% complete-episode success on a separate 60-case validation suite. Each entry below gives the first *observed* crossing and cumulative training tool calls. The evaluation schedule samples seven checkpoints.

| Training seed | Adaptive episodes | Adaptive calls | Uniform episodes | Uniform calls |
| ---: | ---: | ---: | ---: | ---: |
| 13 | 576 | 10,809 | 576 | 10,934 |
| 37 | 1,728 | 29,427 | 2,304 | 38,793 |
| 73 | 288 | 6,068 | 1,728 | 30,368 |

Adaptive crossed earlier in two of the three pairs. The seed-73 adaptive run subsequently fell below the threshold at both the 576- and 1,152-episode checkpoints. The validation success curves averaged over seeds both first crossed 85% at 1,728 episodes. Uniform produced higher final test success for all three seed pairs. These outcomes give limited evidence about training efficiency and do not establish a general acceleration factor.

Across the six runs the operators made 231,255 training tool calls in 13,824 episodes. The included experiment record reports cumulative wall time, process CPU time, sampler counts and validation overhead at each checkpoint. Measurements came from a local Apple M4 Pro with Node 24.18.0. Sampler updates and policy optimization are included in training time. Wall timings for these short CPU runs are sensitive to local load.

## What a missed commitment looks like

On held-out compound seed 3000000, the adaptive demo checkpoint finished with 36 of 41 units delivered. It committed East Yard stock to a different order. When Marina's order doubled and its West Yard lane was closed, East Yard had four more units available to ship there. The operator kept querying the yards and ended with 33 unused credits. The dispatcher had sent the competing order from West Yard. It delivered all 41 units for 112 credits. This is one example selected after evaluation. Across all new-combination cases, the dispatcher had the highest completion rate.

## Reproduce the measurements

Run `node training/audit.mjs` from the repository root. The audit recomputes all 1,344 recorded held-out outcomes from the published checkpoints and verifies successful witness schedules for all 228 validation and test scenarios. The source fingerprint covers the environment, policy features, protocol and training code. The operator is a 34-feature linear softmax policy trained with REINFORCE. The adaptive sampler updates five estimates of family difficulty. Experiments with open-weight language models would require separate training and evaluation.

[Training protocol](README.md) · [Measurements and learning curves](../docs/data/experiment.json) · [Per-case results](../docs/data/test-outcomes.json) · [Checkpoint weights](../docs/data/checkpoints.json)
