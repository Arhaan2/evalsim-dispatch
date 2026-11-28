# Can the fleet protect Friday and keep fit 101’s weekly gains?

Freeze this protocol and the trainer before fitting. Freeze all three checkpoints before opening the historical replay or the new evaluation banks. The prior study found 39 Friday contracts that preposition fit 101 missed and original switch-cost fit 73 served, and 35 with the reverse outcome. Those public examples motivate this experiment. They are excluded from training and selection.

## Policy and training

On the one public preclosure warning each week, choose among the actions proposed by frozen preposition fit 101 (default), frozen preposition fit 211 and original switch-cost fit 73. Collapse identical actions. Outside that board, each policy uses the original switch-cost fit 73 from its own positions. Both Friday rounds count, regardless of warning day or depot availability. A signed delivery is the specific contract served in that half-day. The existing two-truck simulator keeps its loaded and empty travel costs and 34-credit missed-contract penalty.

Train independent fits with seeds 73 (designated primary), 101 and 211. Use the existing eleven long-repair training schedules in release order. For each fit use 16,384 learning and 8,192 separate selection weeks per family, or 180,224 and 90,112 weeks. Start learning at 1,300,000,000 + fit index × 5,000,000. Start selection 1,000,000 seeds later. Within each partition add family index × weeks per family and the zero-based week number. Sample closure starts from [3,5,7] and durations from [1,2,3,4,4,5,5]. The warning occurs one board earlier on Tuesday, Wednesday or Thursday morning. Use none of the development, fresh, clean, double-return or previously published test cases for training or selection.

Follow frozen fit 101 to the warning. For each distinct alternative to its proposed move, replay both choices through Friday on identical freight and repairs. Fit three boosted regressions on the resulting paired differences in Friday contracts, all-week contracts and all-week net credits. Inputs may use observed freight and truck positions, current dispatch economics, each frozen proposal, forecast and repair information observable at the warning. The deployable policy cannot use a family name, simulator seed, later freight, future timing of repair or either branch’s realized outcome.

Use 48 depth-two trees per outcome, 16 quantile bins, learning rate 0.1, minimum 48 training examples per leaf and a leaf denominator offset of 12. Score alternatives by predicted Friday gain + service weight × predicted whole-week delivery gain + net weight × predicted weekly credit gain / 34. Service and net weights are each in [0,0.25,1]. Override hurdles are [0,0.025,0.075]. Keep fit 101 unless an alternative clears the hurdle strictly. Choose the highest-scoring action. Fix deterministic ties in code before training.

Select on the independent selection weeks. Among active settings that increase Friday deliveries and keep both full-week delivery and net totals at least level with fit 101, choose the highest Friday gain, then highest credits, then service, then grid order. If none qualifies, among active candidates maximize the minimum of Friday gain, whole-week delivery gain and net gain / 34, then Friday gain, net gain and grid order. If no candidate changes a move, follow fit 101. Publish every fit and the selection outcomes.

## Evaluation banks

Generate disjoint complete weeks. Each family’s seeds start at the bank base plus 10,000 times the zero-based index in the stated order. The next 4,096, 512 or 128 consecutive integers are used as indicated. All ten development and fresh depot schedules must be distinct from earlier schedules even after renaming the depots.

| Bank | Relative depot sequences, in order | Weeks | Seed base |
| --- | --- | ---: | ---: |
| Development | 0011212010, 0110021021 | 2 × 128 | 1,450,000,000 |
| Fresh closures | 0012020112, 0001220211, 0112002110, 0012201012, 0121002210, 0110202102, 0012122001, 0100211220 | 8 × 4,096 | 1,460,000,000 |
| Clean | Same eight schedules with open depots | 8 × 512 | 1,470,000,000 |
| Original double-return | 0011002200 with open depots | 4,096 | 1,480,000,000 |

Fresh weeks sample closure starts [3,5,7] and durations [1,2,3,4,4,4,5,5,5]. Development samples starts [2,4,6] and durations [1,2,3,4,5]. Repairs may extend beyond Friday. Every dispatcher receives the same public information. Each policy runs whole weeks from the same starting positions on the same hidden freight and repair draws. On open-depot weeks verify that all positioning policies take the same actions as the original fit 73.

## Six primary tests on 32,768 fresh weeks

For each comparison publish the total, mean difference per week and a two-sided 95% paired interval. Use 2,000 bootstrap draws with seed 9713, sampling complete weeks within demand schedule and retaining all weeks. The two Friday contracts from one week must stay together. Intervals apply to new draws on these eight simulated schedules.

1. More Friday signed deliveries than preposition fit 211. Require lower bound > 0.
2. More net credits per week than the rolling closure planner. Require lower bound > 0.
3. More signed deliveries over the full week than original switch-cost fit 73. Require lower bound > 0.
4. More net credits than original switch-cost fit 73. Require lower bound > 0.
5. Preserve preposition fit 101’s full-week signed deliveries. Require lower bound ≥ 0, with zero shortfall allowed.
6. Preserve preposition fit 101’s weekly net credits. Require lower bound ≥ 0, with zero shortfall allowed.

All six must pass for the combined claim. Publish the Friday and weekly effects for all three fits separately. The predeclared primary remains the release policy whether an independent fit performs better or worse.

## Which Friday contracts changed?

Count saves and misses by matching the exact Friday contract across agents. Against the original fit 73, count fit 101’s misses prevented, repeated and newly introduced, and its saves retained, given up and newly made. Report Friday differences against fit 101 and fit 211 even if they include zero. Report interventions, performance on each fresh schedule, and closure-free double-return results. As a control, clearing the learned values while keeping the same decision rule should reproduce fit 101.

After locking the fits, separately replay all 32,768 weeks of the prior public study. Check the original 39 misses and 35 saves against both frozen policies, then apply each new fit. Report recoveries, new misses, saves retained or given up, newly gained saves and the net changes in weekly credits and deliveries. This historical check will never be combined with fresh cases. Independent agent benchmarks should expose both Friday deliveries and full-week outcomes. Publish regardless of result.
