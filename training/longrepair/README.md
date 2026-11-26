# Training the longer-closure fleet gate

The original closure agent sometimes sent an empty truck to a depot pair that earned less than the constant-penalty dispatcher on a long repair. This experiment trains a policy to recognize when the original move is worth taking. Its two legal options are the original closure policy’s move and the constant-penalty move. Both carry the same signed freight on that board. The outcome depends on where the trucks end up for later contracts. [Frozen protocol and implementation](https://github.com/Arhaan2/evalsim-dispatch/tree/89e8312d6d50b36133efb6af8897ad372cd4e9c1/training/longrepair)

## What the policy learns

On each eligible fitting board the trainer branches the two-truck simulator from each of six canonical starting depot pairs. One branch takes the original proposal and the other takes the constant-penalty action. Both dispatch the rest of that same week using the constant penalty. Their Friday ledger differences provide two targets, net credits and contracts served. A backward recurrence over all nine ordered truck placements computes the exact same paired returns while preserving truck-ID tie breaks. Repeated decisions by the released policy can lead to different later actions than the fixed continuation used to label a single decision. [Simulator](../../docs/lib/closure-world.js) · [Trainer](fit.mjs)

The two ridge-regression heads learn corrections to the original closure policy’s estimated credit and service advantages. The features include the warning or closure status, repair age, noisy update, public chance of a four- or five-half-day repair, current freight, next demand bulletins, the original proposal’s estimates and how the proposed move changes depot coverage. The gate receives these observations before acting. Actual reopening time, the hidden freight pattern and future realized loads are available only to the simulator. A week finishing during a repair contributes rewards only through Friday close. [Policy](../../docs/lib/longrepair-policy.js)

The ridge penalty is 0.02 per example on standardized features, with an unpenalized intercept. On a disjoint calibration bank, each head’s raw prediction is centered at its prediction mean, scaled by its fitted least-squares slope clipped to [0, 1.5], and offset by the mean observed advantage. A candidate adds the calibrated net advantage to the calibrated service advantage times 0, 12 or 30 credits per additional contract. It accepts a proposal only when that score exceeds its hurdle of 0, 2 or 5 credits. The tenth candidate always follows the constant penalty.

Each candidate drives its own fleet from Monday opening to Friday close on every selection week. Among candidates with nonnegative mean paired service differences against both baselines, selection maximizes the smaller of the two mean paired net advantages minus one standard error. If none qualify, selection first maximizes the smaller service difference. Ties follow the registered candidate order, starting with the constant policy. The deployed gate repeats the decision whenever the original policies disagree. When no warning or closure is active, both actions are identical by construction.

## Training banks and controls

| Bank | Weeks per freight family | Weeks per checkpoint | Purpose |
|---|---:|---:|---|
| Fit | 768 | 8,448 | Learn the two conditional advantage corrections |
| Calibration | 384 | 4,224 | Set prediction slopes and means |
| Selection | 768 | 8,448 | Compare all ten full-week policies |

The eleven freight families in each bank are historical training schedules. Each repair starts at half-day 2, 4 or 6, counting Monday morning as zero. The main fits draw repair durations uniformly from [1, 2, 3, 4, 4, 5, 5]. Seed 13 was designated for release before training. Independent secondary fits use seeds 37, 73, 101 and 211. The protocol gives the exact deterministic seed ranges. [Protocol](PROTOCOL.md)

The matched short-training control uses the same seed-13 fit weeks, freight arrangements, action space, learner and selection rule. Its fit bank samples durations from [1, 2, 3]. Its calibration and selection banks include long repairs and are identical to the main seed-13 banks. A separate flat gate replaces both calibrated state-dependent predictions with their respective calibration-bank means, keeping the release’s service weight and hurdle. The old closure agent supplies a third comparison. Clear and reopened boards use the original constant policy in each case.

## Reproduce the training

The trainers use Node built-ins, the CPU and the fixed simulator. The release runs used Node.js 24.18.0 on an Apple M4 Pro running macOS arm64. From the repository root, run these commands.

```sh
node training/longrepair/fit.mjs --check
node training/longrepair/audit-fit.mjs
```

The first command refits all five mixed-duration checkpoints and the short-training control and compares the complete JSON bytes. The independent audit dispatches both counterfactual branches forward through Friday, verifies the ridge optimality equations and both calibration fits, and drives all ten selection candidates through the full selection bank. Supply one registered seed or `short-13` as the last argument to check one checkpoint.

## Fitted checkpoints

| Fit | Training pairs | Calibration pairs | Credit slope | Service slope | Credits per contract | Hurdle | Switches on selection weeks |
|---|---:|---:|---:|---:|---:|---:|---:|
| [fit-13](../../docs/data/longrepair/fit-13.json) | 10,441 | 5,344 | 0.618 | 0.994 | 12 | 2 | 80 |
| [fit-37](../../docs/data/longrepair/fit-37.json) | 10,551 | 5,071 | 0.710 | 0.985 | Always constant | — | 0 |
| [fit-73](../../docs/data/longrepair/fit-73.json) | 10,308 | 5,227 | 0.600 | 0.944 | 12 | 5 | 4 |
| [fit-101](../../docs/data/longrepair/fit-101.json) | 10,570 | 5,107 | 0.776 | 0.881 | 30 | 2 | 192 |
| [fit-211](../../docs/data/longrepair/fit-211.json) | 10,356 | 5,279 | 0.560 | 0.954 | 12 | 0 | 38 |
| [short-13](../../docs/data/longrepair/short-13.json) | 5,921 | 5,344 | 0.154 | 0.447 | 12 | 2 | 40 |

The release and short-training control selected the same service weight and hurdle. The long-duration mix generated more eligible disagreements at the same week budget, so the matched comparison includes that difference in training examples. Fit 37 selected the always-constant candidate. The switch counts above refer to the 8,448 selection weeks for each checkpoint. [Fresh-week results and benchmark](../../LONGREPAIR.md)

On the release’s separate calibration set, the old closure proposal averaged −3.945 credits and +0.0161 on-time contracts per eligible placement relative to staying with the constant penalty. At the selected service weight, that gives the flat gate a fixed score of −3.752 credits, below its 2-credit hurdle on every eligible board. The flat gate therefore reproduces the constant-penalty policy. The state-dependent predictions can exceed the hurdle on individual boards.

All six checkpoints reproduced byte-for-byte from a clean source export of the frozen weights commit. The independent forward-rollout audit passed for all six fits, both calibration heads and all sixty full-week policy-selection entries. The largest per-row ridge optimality residual was 2.25 × 10⁻⁸. [Frozen checkpoints](https://github.com/Arhaan2/evalsim-dispatch/tree/e69c913bd1fc95b490029760f28a0c9ca1b1fc05/docs/data/longrepair)
