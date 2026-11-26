# Can the dispatcher recognize a profitable long-repair move?

## Question and information available

In the previous experiment, the two frozen repair policies disagreed 153 times. The released dispatcher kept the short-trained policy's action on every disagreement. With both branches following the short policy afterward, the long-trained policy's alternative would have earned more by Friday in 62 cases, less in 58, and the same amount in 33. Those 62 outcomes motivate the question. Reserve them and the entire earlier evaluation bank outside this experiment's training, calibration, policy selection and test. [Previous study](../shortdefault/PROTOCOL.md)

Keep the two expert dispatchers from longrepair-v1.0.0, the rolling planner, the historical constant penalty, the simulator, and all economic rules fixed. When the experts agree the candidate uses that action. When they disagree, train it to recognize a strictly positive Friday net advantage for the long action. An agency submitting a public benchmark policy can choose any legal joint move. All agents see current truck positions, available loads, the published freight and repair forecasts, elapsed closure time and public updates. The true market family, duration and future realized boards are hidden at dispatch. The planner retains its original uniform one-to-five-half-day repair prior.

The unit of profit is a simulated credit after travel and missed-contract costs. A week has ten contract deadlines, including loads whose depot is closed. On-time service is the percentage served. The new model must earn its advantage over the short dispatcher as well as the two traditional baselines.

## Fit and select the detector

Use eleven historic training freight patterns. Preselect seed 13 for release and publish seeds 37, 73, 101 and 211 as independent replications. For zero-based index i in that order, use seed block 800,000,000 + 1,000,000 × i. Each family contributes 8,192 fit weeks, 2,048 calibration weeks and 4,096 selection weeks. The bank offsets within a block are 0, 200,000 and 400,000, with family index times bank count as the family offset. Fit, calibration and selection use starts [2,4,6] and draw uniformly from the duration list [1,2,3,4,4,5,5]. Monday morning is epoch zero. Score all consequences through Friday close.

An example requires a genuine short-versus-long disagreement. Try both first actions from the same ordered truck positions, expose both to identical freight and repair updates, and use the frozen short policy from the next board to Friday. Record long minus short in net credits and contracts served. A tie belongs to the nonwin class. Compute the short-policy continuation for all nine ordered truck placements. Give unit weight to examples from six canonical starting placements and an additional weight of eight to the actual ordered placement reached by the short expert, including when that placement lies outside the six. Use these weights for fitting and calibration. Count examples, on-path examples and weights separately.

Use a nonlinear model of the paired simulator returns. Fit four squared-error gradient-boosted tree ensembles for (1) strict-win probability, (2) credit gain conditional on a win, (3) magnitude of the loss conditional on a nonwin, including zero for ties, and (4) signed service difference. Inputs include the prior study's 49 publicly observable, direction-adjusted proposal features plus estimates of feasible next-board freight and service under the public demand and repair models. No realized future board enters these features. Each ensemble has 32 rounds of depth-two trees, learning rate 0.12, a minimum of 24 distinct training rows per child and up to 15 quantile cuts per feature. Use weighted residuals and weighted leaf means. Calibrate each head on disjoint examples with a centered slope bounded to [0,1.5]. Clip probabilities to [0.005,0.995] and credit magnitudes at zero. The source frozen with this document fixes numerical ordering, tree ties and exact feature computation.

For predicted win probability p, gain g and downside d, expected additional net credits are p × g − (1 − p) × d. Evaluate 18 switching settings on complete selection weeks: minimum probabilities [0,0.4,0.55], earnings hurdles [0,2,5] and credits per additional contract [0,12]. Require p to reach the minimum and both expected net and service-adjusted expected net to strictly exceed the hurdle. Select the setting with the greatest paired mean earnings gain over always short minus one standard error, among candidates for which that bound is positive and mean service is at least as high as short. Resolve ties in the registered grid order. If none qualify, keep short on every board. Preserve the detector's probability output even when the selected deployment rule keeps short throughout.

For a constant-prediction control, substitute the weighted calibration target means for the four conditional heads while keeping the selected decision settings. Also run always-short, always-long, rolling planner and historical constant penalty on the same weeks. No tuning on the public evaluation cases. Publish the training and evaluation implementation before fitting and all five checkpoints in a second public commit before scoring.

## Fresh freight and incident draws

All six new patterns are distinct under depot relabeling from each other and every earlier fleet pattern. Put adjacent families 10,000 seeds apart within each bank. Draw the incident independently of the freight tape. Each family in a bank uses the same distribution. All fresh test durations fit before Friday close.

| Bank | Freight schedules in manifest order | Closure starts | Duration list, sampled uniformly | Weeks per schedule | First seed |
|---|---|---|---|---:|---:|
| Validation | signal-loop 0012120110, signal-switch 0112001011 | 1 | 1,2,3,4,4,5,5 | 128 | 850,000,000 |
| Fresh | signal-rebound 0010222110, signal-crossing 0112100220, signal-connector 0001212201, signal-homebound 0012011120 | 3,5 | 1,2,3,4,4,4,5,5,5 | 4,096 | 860,000,000 |
| Clean | Same four fresh freight schedules | No incident | — | 512 | 870,000,000 |
| Archive | Original double-return 0011002200 | No incident | — | 4,096 | 880,000,000 |

## Seven joint release criteria

Each of the first six criteria uses the 16,384 fresh closure weeks. For earnings require the lower two-sided paired 95% bound on net credits per week to exceed zero. For service require the mean and lower bound to be at least zero percentage points. The service margin is zero.

| Comparator | Earnings criterion | Service criterion |
|---|---|---|
| Always-short expert | A strictly positive earnings advantage | Match or exceed service |
| Historical constant penalty | A strictly positive earnings advantage | Match or exceed service |
| Rolling planner | Retain a strictly positive earnings advantage | Match or exceed service |

The seventh test requires a strictly positive lower bound on net credits per week against the planner on the 4,096 fresh closure-free double-return weeks. Require all seven for the joint claim. Check action-by-action agreement with the historical constant policy on these weeks and identify the source of the archive result. Bootstrap 2,000 paired whole-week draws within freight family with seed 9713 for individual two-sided percentile intervals. These intervals concern new simulated weeks on these schedules for the locked checkpoint. Report each result even when the joint goal fails.

## Which profitable moves did it actually detect?

1. **Fixed test of recognition.** Follow the frozen short expert from Monday opening. At every board where short and long disagree, record the detector's win probability and the decision its selected rule would take there. Replay a forced long first action followed by short through Friday, and compare it with short's original full-week ledger. The resulting opportunity set and labels are independent of the deployed agent. Report opportunities, genuinely profitable moves, caught and missed wins, accepted losing moves and accepted ties. Precision is caught wins divided by all long choices. Recall is caught wins divided by all profitable long choices. An empty denominator yields an undefined rate. Compare the tie-aware area under the ROC curve and the mean squared probability error (Brier score) with the frozen training-calibration prevalence. These are ranking and probability measures, separate from the deployed rule's threshold.
2. **What happened on the agent's path.** At every expert disagreement the released dispatcher actually encounters, keep the prefix fixed, try both first moves, and follow the release policy on each branch for the remainder. Count adoptions, deferrals, opportunities, credits and service. Show representative decisions nearest the median of each nonempty adopt/defer × better/worse/tied group, in manifest/board order for ties. Whole-week rollouts establish the primary comparisons. Decision forks explain the value of particular moves on a given tape.
3. **Generalization and controls.** Publish full-bank and per-freight-pattern results for the release, differences for actual durations 1–3 and 4–5 and each individual duration, all five fits, and the comparison with constant predictions. Actual duration is an evaluator label. Distinguish a gain over always short from a gain that would also be earned by the inherited policy.

For the primary detector, attach percentile intervals to AUROC and to calibration-constant Brier minus detector Brier. Use 2,000 draws with seed 9713, resampling opportunity-bearing weeks within freight family, keeping decisions from each week together. Hold each family's count of opportunity-bearing weeks fixed and report the number of defined draws for each metric. A draw with only one outcome class has undefined AUROC. These intervals are conditional on weeks with expert disagreements. Repeat this descriptive calculation within the registered duration groups where defined.
