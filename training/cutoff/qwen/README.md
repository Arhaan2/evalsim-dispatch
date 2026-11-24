# Qwen on the cutoff shift

This experiment tests whether reinforcement learning improves a Qwen3-4B operator initialized by expert demonstrations. Frozen Qwen, imitation-only Qwen, imitation followed by RL, the observation-only planner and the no-inspection dispatcher each receive all public observations and all available actions from the cutoff environment. The model sees the complete JSON observation and picks one labeled call. A single legal action executes directly. The actor never receives the seed, family, split, private inventory or sibling outcome.

## Held-out results

| Operator | Complete shifts per 96 cases | Mean strict success |
| --- | --- | --- |
| Frozen Qwen3-4B | 22 | 22.9% |
| Expert imitation | 48, 47, 48 | 49.7% |
| Imitation followed by RL | 48, 48, 48 | 50.0% |
| No-inspection dispatcher | 72 | 75.0% |
| Observation-only planner | 96 | 100% |
| Small CPU RL policy | 96 for every checkpoint across five seeds and two schedules | 100% |

Imitation taught Qwen to send the express truck immediately on urgent cases. Frozen Qwen missed every urgent cutoff. The additional RL training gained one solved shift across 288 paired case/replicate evaluations and lost zero, a mean improvement of 0.35 percentage points (paired bootstrap interval 0 to 2.08 points). All three final Qwen adapters solved just one side or neither side of every uncertain inventory pair. The planner inspected before committing and solved both variants in all 24 pairs. An inspection later in the shift can increase the reported inspection rate after the truck's destination has already been selected.

The local Apple M4 Pro run consumed 198 expert-demonstration calls and 1,243 on-policy RL calls. Training and held-out model evaluation together required 887 uncached decoder forwards, 220,386 evaluated tokens and 351 seconds. The 96 test shifts repeat across all three training replicates. The 288 paired comparisons reflect those repeated cases.

## Protocol

- The decoder and quantized model are pinned in the [original model protocol](../../language-model/protocol.json). Each trainable rank-four adapter has 10,272 parameters on the frozen decoder's 2,560-dimensional output. Six of the eight token slots map to cutoff calls. Each decision masks the unavailable slots.
- Each of three replicates uses its own initialization, demonstration scenarios, RL scenarios and sampling stream. The observation-only planner supplies 24 demonstration shifts per replicate. Two passes of minibatch cross-entropy fit its executed actions. Save those weights as the imitation-only checkpoint.
- Continue from those exact weights with 32 groups of four on-policy stochastic episodes. Each group shares a scenario. Verified terminal reward combines strict fulfillment, on-time units, spend and tool calls. REINFORCE subtracts the other trajectories' mean return. RL receives no planner targets. Both methods update the same adapter factors. The RL continuation adds interactions and compute, so the comparison measures the value of this additional training, not superiority to another equal-budget imitation run.
- Freeze the six final checkpoints, then run greedy deployment on 96 common test shifts made from 24 unseen layout seeds, both timing regimes and both inventory twins. All arms use the same environment generator and actual action menu. Test place names, timing ranges and order-size ranges differ from training. The number of trucks, yards and orders remains fixed.
- The primary comparison is the change in strict completion from imitation to imitation plus RL. Pair each training replicate and each test case. The exploratory percentile interval jointly resamples training replicates and layout seeds, keeping both families and both inventory twins together. Three training replicates give limited precision. Use the individual counts and behavior on uncertain twins to interpret the aggregate.

The [original protocol](protocol.json) fixes the test cases, budgets, checkpoint selection and primary metric. The [report](../../../docs/data/cutoff/qwen.json) includes per-replicate wins, paired uncertainty, inspection rates, both-twin conditional dispatch, actual calls and compute. The [episode transcript](../../../docs/data/cutoff/qwen/transcript.json) contains each demonstration, training and evaluation call, public-menu probabilities for model decisions and terminal metrics. The report's compute covers the measured training/evaluation loop and shared prompt cache. Cache hits reuse the frozen decoder's identical prompt output. Replaying a device run using a warm cache will have lower compute costs.

## Audit or run a new shift

From the repository root with Node.js 22 or later:

```sh
node training/cutoff/qwen/audit.mjs
```

The CPU audit checks artifact and experiment source fingerprints, contracts on all six adapters, all recorded actions and rewards, the matched test suite, greedy choice from recorded probabilities, and the paired statistics. Recomputing the probabilities uses the pinned decoder and actual encoder. For an arbitrary new seed, follow the [local model build and download instructions](../../language-model/README.md), then run:

```sh
node training/cutoff/qwen/play.mjs "$ENCODER" "$MODEL" 91437 uncertain 0 rl 0
node training/cutoff/qwen/play.mjs "$ENCODER" "$MODEL" 91437 uncertain 1 sft 0
```

The arguments after the model are seed, timing regime, inventory twin (0 or 1), operator (frozen, sft or rl) and training replicate index (0 through 2). To retrain all adapters on supported hardware, use an empty private prompt-cache directory and a fresh output directory:

```sh
node training/cutoff/qwen/run.mjs "$ENCODER" "$MODEL" "$CACHE" "$OUT/qwen.json"
node training/cutoff/qwen/publish.mjs "$OUT/qwen.json"
node training/cutoff/qwen/audit.mjs "$OUT/qwen.json"
```

The encoder, model and cache stay local. The release contains the learned action adapters and compact evidence. Qwen's upstream weights have their own [model license](../../language-model/QWEN-LICENSE.txt).
