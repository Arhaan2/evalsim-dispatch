# Does a long-repair move earn its place over the short-repair dispatcher?

## What is held fixed

In the preceding study, the checkpoint fitted on short repairs earned 0.092 more credits per week than the released long-repair checkpoint on 8,192 held-out weeks (paired 95% interval +0.009 to +0.180). Its advantage was 0.146 (+0.038 to +0.276) on four- and five-half-day repairs. Both checkpoints used the same mixed-duration calibration and policy-selection banks. The new experiment treats the stronger checkpoint as the default and learns whether to take the long-repair checkpoint's move when they disagree. [Previous study](../longrepair/PROTOCOL.md)

Pin both dispatchers from longrepair-v1.0.0, short-13 and fit-13, with their original frozen closure, override and uncertainty weights. Keep the ten-board simulator, three depots, two trucks, fees, demand and incident generators, missed-contract penalty and legal menu unchanged. At each board compute both fixed dispatchers' actions on the candidate's own public history and truck locations. If the actions agree, execute the common action. Otherwise choose between those two moves only. An external entrant may pick any legal joint action.

The rolling planner and the historical constant-penalty dispatcher are the same two baseline algorithms as in the preceding study. Both observe the public repair warning, elapsed duration, closure restrictions, any noisy update and the freight forecast. The planner uses its original uniform one-to-five-half-day public prior. Actual incident length and freight schedule ID stay hidden from every policy. The evaluation asks how the published dispatchers fare under the registered duration mix.

## Learn the incremental return

For each eligible training disagreement, send the trucks down both branches of the same synthetic week. Each branch first takes its own proposed move and then follows the frozen short dispatcher through Friday. Subtract the short branch's terminal net credits and contracts served from the long branch's. Compute exact continuation returns across all nine ordered truck placements. Six canonical starting placements contribute fitting and calibration examples. The new dispatcher can reconsider at each subsequent disagreement when evaluating whole weeks.

Use the existing 44 public proposal features, including their intercept, the direction of disagreement and the four frozen credit/service predictions. Orient the non-intercept legacy features and frozen advantages toward the long move minus the short move. The prior offsets use the signed mean of the two dispatchers' respective credit and service estimates. Fit two standardized ridge residual heads with a penalty of 0.05 per row. On a disjoint calibration bank, center predicted returns, fit separate slopes clipped to [0,1.5] and restore the observed mean for each target.

Five independent fits use seeds 13, 37, 73, 101 and 211 in that order. Seed 13 is the release regardless of performance. For zero-based fit index i, reserve the block 700,000,000 + i × 1,000,000. Across the eleven historical training freight patterns, each fit uses 4,096 fitting weeks, 1,024 calibration weeks and 2,048 complete policy-selection weeks per family. Their offsets are 0, 200,000 and 400,000 within each block. Family offsets are family index times the respective bank count. Sample morning closure starts from [2,4,6] and durations uniformly from [1,2,3,4,4,5,5]. Epoch zero is Monday morning. Any closure that runs beyond Friday close contributes outcomes through Friday only.

Compare always following short with twelve settings, using service weights of 0, 12 or 30 credits per additional contract and earnings hurdles of 0, 2, 5 or 10 credits. For a switch, both the calibrated expected net advantage and the service-adjusted advantage must strictly exceed the chosen hurdle. A tie keeps the short move. On the policy-selection bank, require the candidate's mean paired net advantage over short minus one standard error to be positive and its paired mean service difference versus short to be nonnegative. Among eligible candidates choose the highest such earnings bound. Tie order is the short dispatcher, then ascending service weight and hurdle. If none qualify, take short at every board. This selection guard uses training weeks; the registered release tests below use the independent evaluation banks.

As a control, replace the two calibrated advantages with their calibration-set means and keep the release settings. Also run the frozen short and long policies separately on the same bank. The learned rule adds value over delegating only if its full-week paired advantage over short warrants that claim.

## Fresh weeks

Use new freight schedules disjoint under depot relabeling from each other and all historical fleet patterns. Generate the same exogenous tape for every dispatcher for each manifest row. Draw the closed depot and timing independently of freight. Adjacent families in each bank start 10,000 seeds apart. Equal weighting of each fresh family and the same duration distribution in every fresh family avoid mixing duration profiles across schedules. All test closures fit within the observed week.

| Bank | Demand schedules in order | Starts | Duration list sampled uniformly | Weeks per schedule | First seed |
|---|---|---|---|---:|---:|
| Validation | handoff-circuit 0011221001, handoff-switch 0001212110 | 1 | 1,2,3,4,4,5,5 | 128 | 750,000,000 |
| Fresh | handoff-homebound 0111220100, handoff-relay 0012110022, handoff-detour 0001211002, handoff-turnback 0011220112 | 3,5 | 1,2,3,4,4,4,5,5,5 | 4,096 | 760,000,000 |
| Clean | Same four fresh freight patterns | No incident | — | 512 | 770,000,000 |
| Double-return | Original double-return 0011002200 | No incident | — | 4,096 | 780,000,000 |

## Criteria and interpretation

Publish the protocol and scientific implementation before training. Publish the five checkpoints in a second commit before opening the cases. Report results for the designated release even if the best choice on its selection bank is to follow short throughout.

| Registered test | Criterion |
|---|---|
| Fresh earnings vs rolling planner | Paired 95% lower bound in net credits/week strictly above zero |
| Fresh earnings vs constant penalty | Same earnings criterion |
| Fresh on-time service vs rolling planner | Mean difference and its lower 95% bound both at least zero percentage points |
| Fresh on-time service vs constant penalty | Same zero-shortfall service criterion |
| Double-return earnings vs rolling planner | Positive lower bound over 4,096 fresh closure-free draws |

The joint goal requires all five tests. On-time service is the percentage of the ten due contracts fulfilled, including contracts whose depot is closed. Bootstrap paired whole weeks within freight family, holding family counts fixed, using 2,000 draws, RNG seed 9713 and two-sided percentile bounds. Individual intervals describe variation over weeks conditional on these schedules and fixed policies. The joint decision requires all five criteria without selecting a favorable comparator, training seed or subgroup.

Also report paired gains vs always short, always long and constant predictions, all five fits, individual freight patterns, the two duration groups (1–3 and 4–5 half-days), and each actual duration. Count genuine disagreements and long moves accepted, with denominators on the release policy's own trajectory. Fork each genuine disagreement into both possible first actions and then follow the release on both branches. Select the example closest to the median of each nonempty accept/defer × positive/negative/zero subgroup in manifest and board order. Empty groups have no example. These forks hold the prefix fixed and illustrate a choice. Full-week independent rollouts determine benchmark scores. On clean and double-return weeks verify equality to the historical constant policy action for action. Any retained double-return advantage is inherited.
