# Can a dispatcher recover from a depot closure?

## Public rules

Two named trucks operate across three depots for ten half-days. A single depot is chosen uniformly and independently of the freight. All dispatchers see the same freight, Monday demand bulletin, current depot status, one-board advance warning and, if the depot is still closed on its second board, a noisy repair update. The depot reopens publicly when repairs finish. The simulator draws the start and duration uniformly from the schedule's timing profile. A closed depot can release an empty truck or shelter a waiting truck. It cannot handle loaded pickups, loaded deliveries or inbound empty movements. Signed demand stays on the board during a closure. Every due contract counts toward the same service denominator and carries the same 34-credit miss penalty. Traveling loaded and empty carries the original fleet costs.

The rolling planner incorporates depot availability in its finite-horizon calculation, using the full public freight-board distribution and a public repair-duration prior uniform over one to five half-days. Conditional on those durations, the chances of a delayed update are 10%, 25%, 50%, 75% and 90%. It conditions on elapsed closure time and public updates. The constant-penalty control adapts the prior release's frozen fit-13 proposal and penalty rule to the same feasible menu and closure-aware planner. On clear weeks it must reproduce the historical constant policy action for action. Neither baseline nor the trained policy receives family, case seed, incident profile, true reopening time or future freight at dispatch.

## Fitting on closures

The learned policy starts from the constant-penalty dispatcher's call. When a warning or closure is observable and future rounds remain, it can change empty positioning while preserving each truck's signed freight assignment. On clear and reopened boards it delegates to the constant policy. On no-closure weeks its actions therefore coincide with the constant policy's. The double-return test measures **retention by delegation**. It cannot establish a new gain caused by training on closures.

Use simulator-based Monte Carlo policy improvement. Fit paired Friday net-credit and service values from alternative placements with a common constant-policy suffix. The companion source fixes all features, ridge fits, calibration, candidate grids and tie rules. Five independent fits use seeds 13, 37, 73, 101 and 211. Fit 13 is the release regardless of performance. For index i in this order the seed block starts at 500,000,000 + i × 1,000,000. Across the eleven earlier training freight schedules, use 384 independent weeks per family for fitting, 128 for calibration starting 200,000 seeds later, and 384 for complete-policy selection starting 400,000 later. Train on closure starts 2, 4 or 6 and durations 1, 2 or 3. Epoch zero is Monday morning.

Choose the release policy settings using complete selection weeks. Check paired on-time service against both controls using a one-standard-error guard. Select on the weaker of the two net improvements after a one-standard-error adjustment. Include a constant-policy fallback. Freeze the implementation before fitting and publish all five checkpoints before opening any held-out bank.

## Registered weeks

All six new ten-board demand patterns must be disjoint from every earlier fleet pattern up to depot relabeling. Adjacent families within each bank start 10,000 seeds apart. Draw the depot, start, duration and repair bulletin separately from the freight tape. The benchmark publishes its cases for reproduction after release.

| Bank | Freight schedules in manifest order | Possible start epochs | Possible durations per schedule, in order | Weeks per schedule | Seed base |
|---|---|---|---|---:|---:|
| validation | repair-transfer 0012211120, repair-home-run 0110002110 | 1, 7 | 1/2/4 · 2/3/5 | 128 | 550,000,000 |
| test | repair-crossing 0001221002, repair-midweek-loop 0112002210, repair-late-relay 0011102112, repair-last-return 0012220110 | 3, 5 | 1/2/4 · 2/3/5 · 1/4/5 · 2/4/5 | 2,048 | 560,000,000 |
| clean | Same four fresh freight schedules | No incident | — | 512 | 570,000,000 |
| archive | Literal original double-return 0011002200 | No incident | — | 4,096 | 580,000,000 |

## Tests and public replays

On 8,192 fresh closure weeks require a strictly positive lower bound for net credits per week against each of the rolling planner and the published constant penalty. Require both the on-time difference and its lower bound to be at least zero percentage points against each comparator. The service margin is zero. On the 4,096 fresh, closure-free double-return draws require a positive lower bound for net credits over the historical planner. The joint goal requires all five tests. Report all results and confidence intervals, clean-week comparisons, family breakdowns and all five fits. Report differences as paired, two-sided 95% intervals, with 2,000 within-schedule bootstrap resamples of entire weeks and random seed 9713. Week intervals are conditional on the tested synthetic schedules and dispatchers.

Count the incident boards seen on release trajectories, their feasible alternative empty moves, switches away from the constant policy, and weeks where the full action sequences differ. For paired play, use every eligible incident board in the first 32 manifest weeks per family. Replay the identical prefix, try both the constant move and the model's highest ranked other feasible empty move, then follow the release policy on both paths through Friday. Publish the example closest to the median of each nonempty warning/closed × favorable/adverse group for the release's choice, resolving ties in manifest and round order. If every sampled outcome is a tie, show the first tied example. These forks explain a single decision. Whole-week policy comparisons determine the benchmark scores.
