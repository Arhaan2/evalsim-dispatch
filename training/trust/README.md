# Learning when to follow each freight adviser

Three advisers recommend whether to book the current freight offer. The distribution-aware planner prices the remaining truck slots from the public forecast. Closes RL learned from hot- and cold-ending shifts. Drift RL learned from earlier training markets and performed well on the original interrupted drop. The new policy learns how to choose an advised action when advisers disagree. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/trust.html) · [Benchmark your agent](../../TRUST.md)

## Which targets did it meet?

The three-adviser gate recovered the original interrupted-drop performance within the prespecified one-credit margin. It also preserved the planner lead on the previous reversal patterns with new seeds. Its 0.83-credit gain over Closes RL on fresh hot-ending drops left a 0.66-credit gap to the planner. The lower confidence bound reached −1.16, missing the one-credit margin. On fresh reversals the gap to the planner was −0.02 and its interval included zero. The combined target was unmet.

| Matched shifts | Number | Gate mean | Gate minus distribution planner [95% interval] | Gate minus Closes RL [95% interval] | Prespecified outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Fresh hot-ending drops | 2,048 | 55.65 | −0.66 [−1.16, −0.15] | +0.83 [+0.61, +1.03] | Missed planner tolerance |
| Original interrupted drop, new seeds | 1,024 | 48.18 | +11.61 [+10.71, +12.49] | +2.54 [+2.05, +3.03] | Recovered |
| Fresh reversals, both endings | 4,096 | 50.84 | −0.02 [−0.23, +0.19] | +0.05 [−0.09, +0.20] | Planner lead unestablished |
| Previous Closes hot-ending drops, new seeds | 2,048 | 55.85 | −2.46 [−2.90, −1.99] | +1.20 [+0.97, +1.42] | Missed planner tolerance |
| Previous Closes reversals, new seeds | 4,096 | 49.64 | +0.69 [+0.49, +0.89] | −0.16 [−0.28, −0.03] | Retained |
| All fresh shifts | 8,192 | 50.62 | +2.15 [+1.92, +2.39] | +0.15 [+0.01, +0.29] | Descriptive |

On the original interrupted drop the three-adviser gate earned 48.18 credits per shift, compared with 48.03 for Turns and 48.65 for Drift. The gate’s paired differences were +0.15 [−0.33, +0.62] against Turns and −0.47 [−0.78, −0.16] against Drift. Both satisfy the declared one-credit tolerance. Among reversals on fresh patterns, the gate beat the planner by 0.77 [+0.52, +1.01] on hot endings and earned 0.81 fewer credits [−1.20, −0.42] on cold endings. On fresh cold-ending drops it beat the planner by 9.30 [+8.67, +9.94].

### Can the planner and Closes RL alone recover the skill?

| Two-adviser gate | Mean | Minus planner [95% interval] | Minus Closes RL [95% interval] |
| --- | ---: | ---: | ---: |
| Fresh hot-ending drops | 55.89 | −0.42 [−0.90, +0.10] | +1.08 [+0.87, +1.27] |
| Original interrupted drop | 45.72 | +9.15 [+8.37, +9.96] | +0.08 [−0.11, +0.27] |
| Fresh reversals | 50.83 | −0.03 [−0.21, +0.15] | +0.04 [−0.07, +0.15] |
| Previous Closes hot-ending drops | 56.18 | −2.13 [−2.56, −1.68] | +1.53 [+1.34, +1.72] |
| Previous Closes reversals | 49.66 | +0.71 [+0.53, +0.90] | −0.13 [−0.22, −0.05] |

The two-adviser gate met the fresh hot-drop criterion. That criterion allows a one-credit loss against the planner. The original interrupted-drop recovery failed with two advisers: it trailed Turns by 2.31 [−2.95, −1.69] and Drift by 2.93 [−3.48, −2.39]. Adding the Drift adviser and refitting the gate gained 2.46 [+2.00, +2.91] on the original drop, while costing 0.25 [−0.34, −0.17] on fresh hot-ending drops. In the three-adviser comparison, providing history directly to the gate gained 2.42 [+1.94, +2.87] on the original drop and cost 0.36 [−0.46, −0.27] on fresh hot drops relative to the votes control.

## What the routing decisions show

Across 65,536 decision steps on fresh shifts, the trucks were already full at 15,228. At 41,419 other steps all advisers agreed. That left **8,889 genuine routing decisions**. The gate took the action supported by the planner 3,973 times, Closes RL 6,997 times and Drift RL 5,402 times. Support can overlap because two advisers can recommend the same action. Among the 8,889 disagreements it sided with the planner alone 1,018 times and the two history advisers together 4,528 times.

Two fresh market tapes illustrate the switch in a shared decision context. At wave four there was one slot left, the same signed 24-credit offer and identical published forecasts. In both cases the planner passed and both RL advisers booked. On brief-rally-hot seed 11300040 the three earlier offers were 22, 18 and 28. The estimated gain from booking was −0.82 and the gate passed. On brief-rally-cold seed 11300062 the earlier offers were 8, 9 and 28. The estimated gain was +0.28 and the gate booked. Both traces reach this decision by passing twice and then booking. At decision time neither the seed nor its ending label was visible to the router.

## Training the gate

The gate learns from signed revenue less handling cost, in synthetic credits. On a training tape, let a signed offer pay `x` and let `R(c)` be what the fitted downstream gate earns on the remaining tape with `c` trucks. Booking instead of passing changes the realized return by `x + R(c−1) − R(c)`. Positive expected differences favor booking. Both actions are available when the advisers disagree. Agreement fixes the action and contributes its earnings to the earlier decisions.

The fit starts at the last wave and moves backward. At each wave and feasible truck count it estimates the mean difference across training disagreements with similar public observations. The same hierarchy used at deployment groups observations by signed offer and price support, expert votes, and the current bulletin. The full gate further refines the estimate using a previous survey, up to three earlier signed high/low outcomes and the count of older high offers. Each estimate shrinks toward its less-specific parent with 32 pseudo-observations. An unseen leaf backs off to the deepest fitted parent. An unsupported root or return tie follows the distribution planner.

Bookings affect capacity and earnings. The subsequent market offers arrive independently of the booking action. This allows a single all-pass market tape to supply both continuation returns at every feasible truck count. The fit uses downstream decisions from the same training tapes and the known booking mechanics. At deployment only the current observation and expert advice enter the gate. Future signed offers and the simulator’s true demand are unavailable to it.

The **two-adviser gate** refits the entire downstream policy with only the planner and Closes RL. This counts how much of the result a literal history-versus-planner choice can capture. The **votes control** refits the three-adviser policy using the current offer, support, clock, truck count, bulletin and adviser votes. Those votes can still carry the frozen experts’ history information. The comparison isolates the additional historical features provided directly to the gate.

## Split and release choices

Five independent fits use training seeds 13, 37, 73, 101 and 211. Each samples 6,000 distinct market seeds from its own disjoint 12,000-seed block and crosses them with 19 training paths, for 114,000 eight-wave tapes per fit. All three gate variants use exactly the same tapes. A fitting weight of two on hot-ending interrupted-drop training examples emphasizes the earlier weakness. Three cold-closing interrupted-drop paths from the Turns training split provide recovery examples. Every fitting path came from a training split or was newly designated for training.

Validation has 512 shifts. The fresh test has 8,192 shifts from four unseen openings, each crossed with both endings on 1,024 untouched market seeds. Separate seed banks supply 1,024 new shifts from the exact original interrupted-drop generator and 8,192 new shifts on the eight previously published Closes test paths. The archive checks test a known weakness on new offers. Only the fresh test measures transfer to previously unseen paths.

The protocol fixes release seed 13 independent of validation or test performance. Two-sided 95% paired percentile intervals use 2,000 bootstrap samples of complete scenario seeds, keeping all applicable paths and endings together. They describe the released fit and fixed pattern mix. A one-credit noninferiority margin allows up to one mean credit of loss. Per-ending, per-family and control comparisons are descriptive.

The first collection attempt stopped on the opening observation of the first training tape. The collector requested Drift advice with one truck free before the first booking, a state that cannot occur and has no Drift coefficients. Before any fit or evaluation, the collector was corrected to query only reachable capacities. The corrected runner and all criteria were public before fitting resumed. [Initial freeze](https://github.com/Arhaan2/evalsim-dispatch/tree/9b13fa0/training/trust) · [Reachability correction](https://github.com/Arhaan2/evalsim-dispatch/commit/c64e232)

| Fit seed | Validation credits | All fresh shifts | Fresh hot-ending drops | Fresh reversals |
| --- | ---: | ---: | ---: | ---: |
| 13 (released) | 51.31 | 50.62 | 55.65 | 50.84 |
| 37 | 51.45 | 50.65 | 55.77 | 50.85 |
| 73 | 51.45 | 50.64 | 55.78 | 50.86 |
| 101 | 51.20 | 50.63 | 55.71 | 50.88 |
| 211 | 51.30 | 50.66 | 55.78 | 50.88 |

## Reproduce the policy

With Node.js 22 or later, run the following commands from the repository root. The audited release ran on a macOS arm64 CPU. The audit retrains all 15 policies, recomputes the summaries and routing counts, and compares the entire output against the published artifact.

```sh
node training/trust/run.mjs --check
node --test test/trust-policy.test.mjs
```

[Frozen protocol](protocol.mjs) · [Fitting implementation](fit.mjs) · [Evaluation](run.mjs) · [Public policies and case-level scores](../../docs/data/trust/results.json)
