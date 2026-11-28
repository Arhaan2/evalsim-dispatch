# Can fit 73 avoid losses on the moves it added?

In the previous [switch-cost study](https://github.com/Arhaan2/evalsim-dispatch/tree/switchcost-v1.0.0), fit 73 added 24 long choices relative to the move-recall policy on the common short route. Fifteen were profitable, three tied and six lost credits. It also vetoed earlier choices, ending with 89 of 128 profitable opportunities caught versus 83 for move-recall. Those counts motivate this continuation. Keep the previous study's evaluation seeds out of fitting, calibration, threshold selection and fresh evaluation. Do not use its six individual loss cases as labels. The comparator for retention is the frozen switch-cost **fit 73**, including its vetoes and additions.

## What the dispatcher can learn

Keep the simulator, experts, parent and costs fixed. A new gate may veto only a move that fit 73 **added** on a disagreement where move-recall chose short. A veto takes the short expert's action. Follow fit 73 everywhere else. On a fixed reference route this gate can keep or lose a profitable catch. It cannot add a profitable catch beyond fit 73. Its complete route may change after a veto.

Train three independent continuations from that same parent. Designate continuation seed **73** for the release in advance; 101 and 211 measure sensitivity. Fit, calibrate and select solely on 11 established training freight families. Each fit receives 16,384 fit weeks, 8,192 calibration weeks and 16,384 selection weeks per family (180,224 / 90,112 / 180,224 per fit). Start at seed 1,100,000,000 + 5,000,000 times the fit index in the listed order; use offsets 0, 1,000,000 and 2,000,000 for the three partitions, then add family index times per-family count. Closure starts are drawn from [2,4,6] and duration from [1,2,3,4,4,5,5] in half-days.

These additions are rare. Enrich the regression sample by checking six canonical two-truck starting placements per active fitting board, including both trucks at one depot. Take one origin per physical arrangement, with ordered truck IDs in the subsequent rollout. For each eligible addition compare the two first moves under the same realized future freight, following the short expert on both branches through Friday. Learn from the difference in Friday net credits and signed contracts served. Calibration and selection use the truck positions reached on the natural short trajectory. For whole-week selection also evaluate each policy from its own evolving positions.

Use observable freight, repair bulletins and expectations across feasible next boards, together with the frozen predictors. A regularized linear model estimates the chance of a strict loss and strict win, expected downside, expected upside and service difference. Standardize inputs, use ridge 0.10, and calibrate the five outputs on separate weeks with slopes clipped to [0,1.5]. The veto risk score is expected downside minus upside, minus 12 times expected extra contracts, plus 12 times loss probability, minus 18 times win probability. Higher values favor short. Hidden schedules and realized future freight provide labels only.

Set signed cutpoints on natural calibration additions for veto fractions of 0, 1%, 2.5%, 5%, 10%, 20% and 35%. Zero keeps the parent. On independent selection weeks, a nonzero rule must avoid at least one strict loss, give up zero strict wins on the fixed route, earn more than fit 73 on its own complete route, and match or improve mean service against both fit 73 and always short. Among qualifying rules choose the greatest number of avoided losses, then the largest counterfactual Friday credit saving, then the narrower veto. Follow the parent if none qualifies. Publish all candidates and sample counts. Freeze trainer and protocol before fitting; publish all three fitted models and selected rules before opening any evaluation split.

## Held-out banks

The ten new schedules must be distinct from one another and previously used schedules even after relabeling depots. Simulator settings and training are common to all policies. A closure start is a zero-based half-day from Monday morning. Each bank's first seed plus 10,000 times the listed family index starts its block of consecutive weeks.

| Split | Schedules and relative depot sequence | Weeks per schedule | First seed | Repair starts and duration |
|---|---|---:|---:|---|
| Validation | guard-crossing 0011210221, guard-pivot 0001220102 | 128 | 1,150,000,000 | [1], [1,2,3,4,4,5,5] |
| Fresh | guard-return 0011202101, guard-ramp 0100122211, guard-departure 0010021221, guard-loop 0120021120, guard-handoff 0012110200, guard-relay 0112201022, guard-split 0011220102, guard-turn 0100221210 | 8,192 | 1,160,000,000 | [3,5], [1,2,3,4,4,4,5,5,5] |
| Clean | Same eight fresh schedules, open depots | 512 | 1,170,000,000 | None |
| Double-return | Original double-return 0011002200, open depots | 4,096 | 1,180,000,000 | None |

## Nine preregistered tests

1. **Avoid costly additions.** Follow the short expert through the 65,536 fresh weeks. At each disagreement score both actions with forced-short continuations through Friday. Among the additions that frozen fit 73 takes on that common route, compare the number of accepted strict losses for the parent and release. Divide the reduction by all fit-73 additions. Require the lower two-sided paired 95% confidence bound to exceed zero.
2. **Keep profitable recall.** On every expert disagreement along that same route compare the release's and fit 73's share of all strictly profitable long actions caught. The retention margin is zero. Require both the difference and its lower 95% bound to be at least zero. Also publish absolute counts, within-additions profitable recall, and paired recall differences for fit 73 and the release versus the older move-recall policy. These comparisons reveal whether the gain that motivated this study repeated.
3. Earn more net credits per fresh week than always short.
4. Earn more than the constant penalty.
5. Earn more than the rolling planner.
6. Match or exceed always-short on-time service on fresh weeks.
7. Match or exceed constant-penalty service.
8. Match or exceed planner service.
9. Earn more than the planner on 4,096 new draws from the original double-return schedule. Check action agreement with the historical constant-penalty dispatcher and credit inherited gains accordingly.

For the economics, replay each agent on its own route; earnings must have a strictly positive lower bound and service must have a nonnegative point estimate and lower bound. All ten scheduled contracts count. Use 2,000 paired bootstrap replicates, seed 9713, resampling complete weeks within each schedule. For recognition resample opportunity-bearing weeks within schedule and keep all a week's decisions paired. Report an undefined bound as inconclusive. The intervals cover draws on these eight schedules. Report all nine, all three continuations, and the whole-week credit and service difference versus fit 73. All nine tests must pass to support the joint claim.

Publish the simulator, immutable model hashes, fixed cases, actions/ledgers, repeatable JavaScript and Python benchmark and a study-library entry irrespective of outcome. A visitor's agent may choose any legal joint action.
