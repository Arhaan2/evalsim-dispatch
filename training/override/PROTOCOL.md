# When should an overnight dispatcher override the planner?

## Intervention and criteria

The rolling planner and the trained policy receive the same legal actions, Monday forecast, signed loads and observed demand history. They use the same five-day simulator, travel charges and missed-contract penalties. At the four afternoon dispatches before Friday, the learner may change where an idle truck spends the night. Every signed load stays on the truck the planner chose on that board. The planner handles mornings and the Friday close. A dispatcher never receives a week seed, market name or future arrivals.

Designate fit 13 as the release before training. Evaluate three separate claims.

1. **Earnings.** Across the four fresh schedules, the lower bound of the paired 95% interval for the average weekly net credit difference against the rolling planner must be strictly positive.
2. **On-time service.** Across those same weeks, the release must serve at least the planner's observed share of the ten due contracts and the lower bound of the paired service difference must be at least zero percentage points. The allowed shortfall is zero.
3. **Double-return recovery.** On fresh draws from the original double-return schedule, the lower bound of the release's paired net earnings difference against the planner must be positive. Run the original unrestricted fleet RL and the preceding overnight RL on those exact tapes and report their differences from the planner. Recovery concerns a positive advantage; the original win's magnitude is reported separately.

The joint claim requires all three. Report each verdict and every training replicate regardless of outcome, including a selected policy that always follows the planner. Reuse the earlier stratified paired whole-week bootstrap with 2,000 replicates and seed 9713. Each schedule contributes the same number of weeks. The intervals describe synthetic week-to-week variation for a fixed checkpoint on the specified schedules. They do not estimate variation across all possible logistics networks.

## Train, select, then open the evaluation banks

Fit separate policies with seeds 13, 37, 73, 101 and 211 on CPU. Use the original seven training schedules plus four train-only return schedules with patterns 0011102200, 0001122000, 0110022110 and 0012211000. A symbol designates a latent depot; the simulator rotates and reflects depot labels separately for each week. Withhold the original double-return schedule and every fresh or validation schedule, including permutations of depot labels.

For fit index i starting at zero, training begins at 200,000,000 + i × 1,000,000. Generate 768 weeks per training schedule. The training-only selection bank begins 200,000 seeds later and draws another 384 weeks per schedule. This gives 8,448 fitting and 4,224 selection weeks per seed. The policy implementation, including its features, return targets, tie-breaking and fallback, is frozen before training. Evaluate all five fixed checkpoints only after training and selection have finished for all five. Do not use any evaluation split to change a feature, settings, seed or sample count.

Use paired Monte Carlo action advantages. On a training tape, compare ending the current board in different truck placements and following the rolling planner through Friday. Use separate fitted heads for net earnings and fulfilled contracts. Include the immediate empty-trip cost in the decision. Choose the strongest eligible challenger from legal placements preserving signed work, and learn whether its advantage over the planner clears a hurdle. Training-only selection crosses correction blends of 0.5 and 1, service credits of 0, 12 and 30, and hurdles of 0, 2 and 5 credits. Include always following the planner as a candidate. Select on complete weeks with the service lower bound (mean minus one standard error) at least zero, maximizing the corresponding earnings lower bound. The public earnings ledger uses actual revenue and charges. Service weights affect decisions only.

| Split | Schedules and underlying depot patterns | Seeds |
|---|---|---|
| Validation | split-relay 0012220011, delayed-loop 0001122210 | 128 each starting at 250,000,000 |
| Fresh | staggered-return 0001102200, second-return 0110001220, friday-detour 0011200112, relay-backtrack 0011122110 | 1,024 each starting at 260,000,000 |
| Original double-return | double-return 0011002200 | 2,048 starting at 270,000,000 |

Within each split, advance the seed start by 10,000 for each successive schedule in the table. Preserve the ten-action, one-second-per-action benchmark and the public JS/Python interface. These banks are public for replication once released.

## When did an override help?

Compare the release against the rolling planner (always decline), forcing its challenger on every eligible night (always accept), the original fleet RL, the preceding overnight RL and a greedy dispatcher. Compute each policy's gains from end-to-end weeks starting in the same truck positions on the same freight tapes.

Separately, trace the release's own path. At each eligible board, fork once with the planner and once with the best non-planner challenger, preserving the prefix and freight. On both paths use the release policy from the following round through Friday. Record both net ledgers and service outcomes. Summarize accept and decline decisions by whether the decision helped, hurt or tied the other branch. For each present accept/decline × positive/negative group, illustrate the case closest to its median net difference; break ties by manifest order then decision round. Omit empty groups. Repeated forks can share a week and their returns must not be added together as a policy gain.
