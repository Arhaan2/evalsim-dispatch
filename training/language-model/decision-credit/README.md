# Decision-level credit for the Qwen dispatcher

On the fixed 21-case test suite, the trained adapter completed 4 shifts, frozen Qwen completed 2, and the conventional dispatcher completed 17. The adapter used 405 tool calls to deliver 555 of 665 units on time. Frozen Qwen used 277 calls to deliver 468 units on time. Four previously failed shifts became successes, and both previously successful shifts became failures. Training required 1,117 on-policy calls and 70,100 additional simulated calls in 5,964 alternative continuations. Training and evaluation used a single Apple M4 Pro. [Published per-case outcomes and compute](../../../docs/data/llm-credit/results.json)

A terminal reward evaluates a complete shift, even when only a handful of early choices determine its outcome. This follow-up asks whether a frozen Qwen decoder can learn more from each visited decision when the simulator can try every offered tool call. The starting policy is the original Qwen checkpoint with a freshly initialized rank-four residual on its eight constrained action-token logits. Training and inference use its real final decoder hidden state.

## How training works

1. Start a fresh shift and show the current operator the ordinary public observation through the existing prompt and tool-menu builder.
2. At a decision with at least two candidates, clone the current simulator state once for each offered call. Execute that call in its clone. Then let the public hand-written dispatcher act from observations until that branch reaches a terminal ledger.
3. Score each verified branch by on-time unit fraction plus 0.70 for strict success, minus 0.05 times the fraction of budget spent, 0.003 per tool call, and 0.008 per rejection. These branch returns estimate the value of a first action **under dispatcher continuation**. The dispatcher has its usual public action menu, which can include actions outside the Qwen menu. Each branch shares the current scenario's latent state and scheduled events. This gives the training evaluator information that the acting operator lacks.
4. Convert those returns to target probabilities with a softmax temperature of 0.06. Blend in 2.5% of the frozen model's action probabilities as an anchor. Scale the decision's weight by its branch-return range divided by 0.15, capped at one. A decision where every action yields the same score contributes zero gradient.
5. Sample the actual next call from the current adapted model at temperature 1.5. Execute it in the original simulator and repeat. The on-policy action comes from Qwen, independently of the counterfactual target. Update both adapter factors with Adam after eight multi-choice decisions, or flush at shift end. The pre-Adam global gradient norm cap is 0.8. Input- and output-factor learning rates are 0.0025 and 0.0275, respectively.

This is model-based policy improvement using simulator-derived soft targets. Its additional branch rollouts and scripted continuation are part of the training budget. In validation and testing, Qwen sees the ordinary prompt and chooses the most probable available action. Neither the candidate returns nor the dispatcher continuation are available to it. A one-choice menu executes its forced action with no decoder call.

## Fixed comparison

- Train on 60 complete stochastic shifts, cycling the five original training families 12 times. Training seeds are 71,000,000 through 71,000,059. The adapter initialization and action-stream seed is 380533. Running a minibatch update inside a shift changes the distribution for subsequent actions.
- Validate the initial checkpoint and the checkpoints after 30 and 60 shifts on the same ten cases, seeds 72,000,000 through 72,000,009. The threshold is 85% strict episode success. Always use the checkpoint after 60 shifts for the final test.
- Evaluate base Qwen, adapted Qwen and the hand-written dispatcher on 21 previously unused paired cases, seeds 73,000,000 through 73,000,020. The seven families each contribute three cases. Closure plus demand surge, and the shifted network with disruption, are absent from training. Every reported case runs from the initial world state to termination.
- Primary outcome is complete on-time fulfillment with all resource constraints verified. Other outcomes include total on-time units and demand, freight spend, rejected calls and tool calls. Report absolute counts. A single paired suite of 21 cases leaves substantial uncertainty, particularly within a three-case family.
- This follow-up has different seeds, trajectory budget, objective and training compute from the terminal-return pilot. Direct effect estimates use its paired base and dispatcher controls. Cross-pilot differences cannot isolate credit assignment as the sole cause.

## Run and inspect

Use the encoder build and model checksum in the [original pilot instructions](../README.md). Run one model job at a time with a dedicated private progress directory. Interrupted executions resume after the last completed training trajectory, validation case or paired test case.

```sh
node --test training/language-model/decision-credit/gradient.test.mjs
node training/language-model/decision-credit/run.mjs "$ENCODER" "$MODEL" "$CREDIT_RUN" docs/data/llm-credit
node training/language-model/decision-credit/audit.mjs
```

The run writes `adapter.json`, `results.json`, and one recorded trace per evaluation mode from the first compound test case. The result includes all actual training actions, branch scores and counts, optimizer step summaries, validation actions, final paired action lists and each held-out Qwen decision's offered slots and probabilities. It records wall time by phase, uncached decoder forwards, token counts, operator calls and counterfactual branch calls. The cache reuses frozen encoder outputs for identical prompts. Recorded compute covers completed saved work; an interrupted in-progress unit may be repeated.

The CPU audit rebuilds training states and independently re-executes every candidate branch and dispatcher continuation. It also replays the three validation checkpoints, all 63 held-out episodes and the featured traces, verifies the public summaries and checks the source, model and adapter fingerprints. The audit checks that saved Qwen probabilities choose the recorded legal actions. Regenerating decoder outputs requires the pinned weights and encoder. The gradient test checks every coordinate of both rank-four factors on a synthetic small hidden vector and exercises the full trajectory path without a model download.
