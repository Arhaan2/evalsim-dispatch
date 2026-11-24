# The cutoff experiment

Can an operator learn when to pay for a stock count, then dispatch a truck differently depending on the answer? Five independently seeded training runs per curriculum learned this behavior on all 48 pairs of stale-report test shifts. The observation-only planner also solved all 48 pairs. The public browser runs the checkpoint for training seed 13. [Run a shift](https://arhaan2.github.io/evalsim-dispatch/cutoff.html) · [All measurements and weights](../../docs/data/cutoff/results.json)

## What changes between two shifts

Two customers each need one complete load. The central express truck has enough stock for either one and can depart once. A shared local carrier leaves later and can pick up at either satellite yard, each of which serves one customer. Exactly one yard has its customer's load. The other yard is empty. The express truck must serve the customer whose yard is empty.

In a flexible shift, both yards report that they expect their stock. The public opening is identical across the two possible locations of the real stock. Inspection costs one credit and advances the clock one tick. It confirms both physical counts. In an urgent shift, signed counts are accurate at opening and the express truck must depart immediately. In both families, the local carrier opens after the express cutoff. A booking may fail for insufficient physical stock. A successful booking dispatches a load of recorded size, and the shipping time determines delivery.

The central trip costs four credits, the local trip two, and the shift budget is seven. Both customers must receive every unit before or at the deadline. A verifier reconciles stock against the initial manifest, booking calls against departure and arrival records, charges, and resource constraints. Calls, rejections and waits consume time. A wait jumps to the next dispatch window. Physical arrivals settle automatically after booking both loads or closing all dispatch windows.

## Results

| Operator | Complete shifts out of 192 | Uncertain shifts out of 96 | Urgent shifts out of 96 | Inspected first, changed destination and solved both twins out of 48 |
| --- | ---: | ---: | ---: | ---: |
| Zero-weight policy | 48 | 48 | 0 | 0 |
| Planner with inspection disabled | 144 | 48 | 96 | 0 |
| Public-observation planner | 192 | 96 | 96 | 48 |
| REINFORCE, uniform practice | 192 | 96 | 96 | 48 |
| REINFORCE, learning-progress practice | 192 | 96 | 96 | 48 |

Each trained row held for **every one of the five training seeds**. Every arm faced the same 192 cases. The learned and hand-written policies used identical observations and calls. No-inspection success on half of the stale-report shifts follows from the indistinguishable paired openings. The zero-weight policy uses the first listed call in a score tie. That baseline's result depends on the menu order.

Three of the ten learned checkpoints also inspected the accurate yards *after* the urgent express truck departed. Their delivery outcomes matched the planner's with additional cost. The other seven inspected only the 96 uncertain shifts. The frozen test layouts use different route lengths and departure windows, renamed and reordered yards, and a wider range of quantities. All still have two customers and the same two-carrier network structure. This benchmark isolates one skill and reaches a ceiling with a small observation-only planner.

## Policy and curriculum

The 15-coefficient linear policy scores the common action menu using action type, current report/requirement ratio, freshness, travel time, remaining departure slack, and window availability. Coefficients are shared across the two customer positions. Training starts from zero and samples actions under a softmax. REINFORCE uses the terminal return and a running baseline with Adam updates after complete episodes. The reward is strict success plus the fraction of units delivered on time, less 0.025 per credit and 0.01 per tool call. Final evaluation chooses the highest-scoring action.

Each arm gets 4,096 simulator tool calls, split into sixteen 256-call blocks. Incomplete episodes at a budget boundary are charged and provide no update. The uniform arm picks either family with equal probability. The progress sampler compares the previous and current operators on both stock variants of four fresh seeds per family at each new block. Its next family weights are 0.15 plus each family's positive change in success. The first block uses uniform probabilities. Both pre- and post-checkpoint probe trajectories count toward the progress arm's budget. This teacher is a measured sampling rule with two choices. Scenario design and the learning-progress calculation are hand-written.

The prespecified target requires 85% strict success at two consecutive validation checkpoints on 96 fixed shifts. Counts below are cumulative calls at the *second* checkpoint. Alignment by tool calls gives both operators the same learning budget. Validation work is measured separately for both.

| Training seed | Uniform calls to target | Progress calls to target | Calls spent measuring progress over all training |
| ---: | ---: | ---: | ---: |
| 13 | 1,280 | 1,024 | 1,376 |
| 37 | 1,024 | 512 | 1,360 |
| 73 | 768 | 768 | 1,316 |
| 101 | 512 | 512 | 1,328 |
| 211 | 768 | 1,024 | 1,341 |

The median was **768 calls in each arm**. Progress reached the target earlier on two seeds, tied twice, and reached it later once. These results establish no consistent training speedup. The machine-readable results include cumulative validation calls and total calls including validation at the crossing.

## Protocol and reproduction

The [fixed protocol](protocol.mjs) specifies training replicates, case ranges, optimizer step size, budgets, evaluation interval and checkpoint rule. Training samples fresh seeds from 100000–199999. Validation uses 200000–200023, and the test suite uses 300000–300047. Each seed is crossed with two families and both stock variants. The curriculum's separate training-world probe seeds are never used for fitting the operator. The model receives no scenario key, stock variant or future schedule. All cases are publicly reproducible. Future benchmark revisions should reserve new test cases.

The [results file](../../docs/data/cutoff/results.json) contains all ten runs, per-family measurements, twin counts, learning curves, sampler weights, final parameters, and 192-bit result masks ordered by seed, family (uncertain, urgent), then variant (0, 1). A paired bootstrap resamples training seeds and scenario seeds while retaining both families and both variants for each scenario seed. All runs saturated this particular test, so the bootstrap intervals for final improvement collapse to the observed differences. These intervals do not cover changes in the scenario rules.

The reference run used Node.js 24.18.0 on one Apple M4 Pro CPU process under macOS arm64, with no external packages. Run from the repository root with Node.js 22 or later. The CPU audit retrains all ten operators and recomputes baseline outcomes, paired behavior, probes, curves and artifact fingerprints.

```sh
node --test test/cutoff.test.mjs
node training/cutoff/run.mjs --check
```

To regenerate the results file, run `node training/cutoff/run.mjs`. Browser inference imports [the environment](../../docs/lib/cutoff.js) and [policy](../../docs/lib/cutoff-policy.js) directly. The environment, observation builder, verifier, policy and training protocol are versioned separately from the original harbor lab. The [Qwen experiment](qwen/) uses the same tool menu and has its own protocol and compute accounting.
