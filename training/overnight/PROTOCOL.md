# Overnight fleet positioning protocol

## Question and unit of analysis

Can a dispatcher learn when an idle truck should move empty before tomorrow's orders arrive, earn more than the published rolling planner on fresh weeks, match its on-time rate and retain the earlier double-return win? Use the existing five-day, two-truck, three-depot fleet simulator. Cargo assignments on every board, daytime decisions and the closing Friday afternoon come from the same rolling planner. Only waiting and empty repositioning of idle trucks on Monday through Thursday afternoons may change. Synthetic orders, prices, travel costs and penalties remain those of the original fleet release.

Fit five CPU checkpoints with fixed seeds 13, 37, 73, 101 and 211. Designate 13 as the release before fitting. All fitting and policy selection use the seven original training families and disjoint train-only seeds above 99,999,999 and below 150,000,000. The fit implementation fixes the features, training sample size, candidate policies, selector and tie-breaks. Fit all five before inspecting validation, fresh or archive performance. The three evaluation splits and their generators are public for replication after this freeze. The test is held out of this study's learning and selection; it is not a concealed benchmark for subsequent users.

## Primary criteria

1. On the pooled fresh weeks the lower bound of the paired 95% interval for the release policy’s mean net earnings minus planner earnings must exceed zero.
2. Matching on-time service means the observed share is at least the planner’s share and the lower bound of the paired 95% difference is at least zero percentage points. This study allows no service shortfall.
3. On 1,024 new draws from the original double-return pattern, the lower bound of the paired 95% net earnings difference against the planner must exceed zero. Compare the original release on those same draws as a replication check.

The joint claim requires all three. Report exact component verdicts even when the joint claim fails. Show the five fits separately. The primary intervals resample whole paired weeks within each schedule, preserving weights, for 2,000 replicates with bootstrap seed 9713. They quantify week-to-week variation conditional on this fit and these synthetic schedules. Report all four per-schedule comparisons as secondary, including the two new patterns with double returns.

## Weeks, costs and controls

Validation comprises 2 × 128 weeks starting at 150,000,000. The fresh test comprises 4 × 512 weeks starting at 160,000,000. Within each split, the next schedule’s seed block begins 10,000 higher. The archive comprises the original double-return pattern with seeds 170,000,000–170,001,023. The four fresh schedules are different from all original training and evaluation shapes under depot relabeling. A week is ten joint decisions for both trucks, with ten hard-due contracts. Policies receive the same immutable observation and legal actions, under a one-second decision budget. Neither the week seed nor the family name is a policy input.

Score the new learned agent, original fit 13, published rolling planner, greedy baseline and an ablation of the new learner which replaces each overnight empty departure with waiting. The ablation preserves signed assignments, then adapts on its own resulting trajectory. All net earnings subtract loaded travel, empty mileage and missed-contract penalties. Compare on-time service from actual contracts served. Never sum diagnostic effects to estimate a full-week policy gain.

## Matched decisions and replays

Follow the released policy through each tape. For each eligible Mon–Thu afternoon hold the prefix, signed loads, assignments, freight tape and future learned policy fixed. If an empty truck moves, compare against waiting all idle trucks. If all idle trucks wait, use the planner’s highest-ranked alternative that moves at least one idle truck while preserving bookings. Rerun through Friday. Record the choice, alternate sequence of actions, final net and contracts served. Count helpful, harmful and tied choices separately for move and stay. These repeated forks from the same week are descriptive. They are not independently sampled treatment effects.

Also compare every actual disagreement with the planner on that exact pre-action position. Fork to the planner's single joint action, then use the learned policy from the following round. Distinguish initiating, avoiding and redirecting empty moves; count outcomes relative to that fork. For illustrated replays take the case closest to the median nonzero payoff in each available move/stay × beneficial/costly group. Break ties by manifest order then epoch. No sign is manufactured when a group is empty.
