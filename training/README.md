# Operator training protocol

The browser runs local inference over tool calls. Each action gets a linear score from the operator's observation and the call's arguments. Factors include estimated inventory, shipping cost, deadline slack, quantity, other commitments depending on the same source, and the age of reports. A zero-weight checkpoint initializes every action equally. Training samples from the softmax. Evaluation and the interactive demo use the maximum score, with a deterministic tie-break based on visible state. All features and weights are public.

The policy never receives the simulator's private stock, a feasibility witness, scenario family, random seed, expert action, or future event. Its authored feature vocabulary encodes logistics knowledge. Its preferences are learned from interactions. The dispatcher is a separate hand-coded baseline.

## Prespecified experiment

- Train each sampler from the same zero weights in three replicates (13, 37, 73). The first replicate supplies both live trained checkpoints. Use the final checkpoint for every test evaluation.
- Use five training families (normal operations and four single disruptions), distinct training seeds for each replicate, 2,304 episodes per trial, and 24 episodes per update. The matched adaptive and uniform runs share the sequence of scenario seeds. Their family assignments and resulting trajectory lengths can differ.
- Uniform draws families with equal probability. Adaptive maintains an exponential moving average of training success by family, initialized at 0.5 and updated with rate 0.05. It mixes 20% uniform sampling with 80% sampling proportional to squared smoothed failure rate, `(0.2 + 1 - successEstimate)^2`. It learns family difficulty from the sampled operator's training outcomes. Validation and test reports never update this sampler.
- REINFORCE uses reward-to-go (discount 0.99), a moving return baseline by family and five-decision time bucket, and Adam (learning rate 0.055, moments 0.9 and 0.999). The gradient is averaged over decisions in a batch. Rewards come from the simulator. Only on-time arrivals receive delivery credit. Expenditures, tool use, and rejected calls have costs, and full feasible fulfillment earns a terminal bonus.
- Use 60 fixed validation cases (12 new seeds per training family) at episodes 0, 96, 288, 576, 1,152, 1,728 and 2,304. The competence threshold is **85% of episodes satisfying all commitments and constraints**. Record the first observed crossing, tool calls, episodes, and measured training CPU and wall time. Sampling and optimizer time are included. Validation time and tool calls are recorded separately. A crossing only bounds when competence was reached.
- A 100-episode random-action CPU pilot measures simulator throughput and typical rollout length. Its disjoint seeds are excluded from the training, validation and final-test suites. Pilot memory is peak process RSS, including Node. Training wall times are host-dependent.
- Evaluate the final frozen policies across 168 untouched cases: 24 fresh seeds in each training family and each of two new combination families (compound and network shift). All policies face exactly the same test cases. Publish outcomes for every case and replicate, including the untrained and dispatcher controls. Family strata have equal case counts. Replicate means are descriptive. The same 168 cases recur across checkpoints, so these rows do not represent independent new test cases for every agent.
- Primary metric is complete on-time, constraint-respecting episode success. Secondary metrics are mean per-episode fraction of units fulfilled on time, spending, number of tool calls and verifier violations. Each fraction weights episodes equally. The comparison reports observed success and threshold crossings, including failures to reach the threshold. It does not extrapolate these measurements to language models, other environments or GPU training.

## Reproduction

Run from the repository root with Node 22 or above. Training and browser inference use only built-in JavaScript facilities.

```sh
node training/run.mjs pilot
for seed in 13 37 73; do
  node training/run.mjs train adaptive "$seed"
  node training/run.mjs train uniform "$seed"
done
node training/run.mjs publish
```

Raw trial checkpoints are written to `training/runs/`. The publish command verifies that all six trial fingerprints equal the current simulator, policy, protocol and trainer fingerprint. It writes the experiment record, both demo checkpoints, and per-case held-out outcomes to `docs/data/`. Seeds fix the performance measurements. Machine load affects timing and peak process memory. The version of Node and CPU platform used in the published run are recorded in the result.

Run `node training/audit.mjs` to recompute every published held-out outcome from the shipped final weights without retraining. The same script verifies a feasible witness schedule for every validation and final scenario. Witnesses have access to the scenario definition. Operators receive only public observations.

The candidate menu includes booking, replenishment, inventory checks, supplier checks, capacity checks and advancing the clock. Human-authored menu rules filter implausible quantities and calculate the offered booking size. The experiment measures learning to select among these calls. It does not measure free-form argument generation or model pretraining.
