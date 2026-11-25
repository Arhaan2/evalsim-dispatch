# Learning the value of tomorrow's truck positions

Every half-day, the dispatch desk has two trucks, three depots and three signed jobs. A move earns its posted net amount immediately. Its other consequence is where each truck starts the next half-day. This study learns a continuation value for each of the six distinct pairs of truck locations. Dispatch scores each legal joint move by adding its posted net credits to that learned value. At Friday close, the continuation value is zero. [Study protocol](./PROTOCOL.md)

## Results on fresh weeks

The frozen release earned **339.73 net credits per week** on 2,048 fresh weeks. The rolling planner earned **342.40** and the greedy dispatcher earned **269.05**. Across the same weeks, the RL policy trailed the planner by 2.67 net credits (paired 95% interval −4.60 to −0.79). It beat greedy by 70.68 credits (+66.07 to +74.99) and served 17.18 percentage points more contracts (+16.48 to +17.89). The planner comparison missed the registered joint goal. [Play the published study](https://arhaan2.github.io/evalsim-dispatch/fleetweek.html#results) · [Pre-training freeze](https://github.com/Arhaan2/evalsim-dispatch/tree/baa2fcec18265a3f80fc26d868487e7aa01de346/training/fleetweek)

| Policy | Net credits per week | On-time contracts | Weeks with ≥7 of 10 served | Empty miles per week |
|---|---:|---:|---:|---:|
| Release RL (fit 13) | 339.73 | 74.20% | 1567 / 2,048 | 50.70 |
| Rolling planner | 342.40 | 74.84% | 1608 / 2,048 | 51.24 |
| Greedy | 269.05 | 57.02% | 653 / 2,048 | 0.00 |

Both policies cleared the 70% aggregate service target. RL served 0.635 percentage points fewer contracts on average. The lower endpoint of its service difference was −1.00098 percentage points, narrowly outside the registered −1.00-point margin. The net-credit interval was wholly below zero. RL earned more on 547 weeks, tied on 904, and earned less on 597. All four unseen schedules received 512 independently seeded weeks each.

| Unseen market | Net credits per week vs planner [95%] | On-time difference, percentage points [95%] |
|---|---:|---:|
| friday-switch | −7.23 [−11.06, −3.35] | −1.37 [−2.13, −0.64] |
| split-week | −5.13 [−9.05, −1.39] | −1.02 [−1.72, −0.29] |
| midweek-pivot | −3.21 [−6.68, +0.46] | −0.59 [−1.23, +0.08] |
| double-return | +4.89 [+1.18, +8.84] | +0.43 [−0.29, +1.15] |

On double-return weeks the release out-earned the planner by 4.89 credits and met the registered service comparison within that schedule. This is a secondary subgroup of the pooled test. The two separate validation schedules comprised 256 weeks. The primary fit earned 2.75 credits less per week than the planner there, with an interval of −7.63 to +2.19. [Scored reference weeks](../../docs/data/fleetweek/test.json) · [Complete results](../../docs/data/fleetweek/results.json)

## Two overnight decisions on the same freight

Each example begins at the first differing joint move on its week. A branch comparison swaps that move alone, then runs the same released RL dispatcher from either resulting placement. The complete-policy comparison also allows subsequent decisions to differ.

**Monday repositioning paid off.** On Friday-switch seed 86000042 both dispatchers took a contract from Junction to Inland on Monday afternoon. RL sent the spare truck from Inland to Junction and earned 12 that half-day. The planner sent it from Inland to Harbor and earned 16. On Tuesday morning the Junction truck could book a paying spot load while the other truck served the Inland contract. Running RL from either position made 52 at Junction versus 14 from Harbor, then brought both branches to the same depots. Swapping the Monday choice gained 34 credits for the week. The complete RL and planner policies earned 379 and 336 respectively. [Play this week](https://arhaan2.github.io/evalsim-dispatch/fleetweek.html?family=friday-switch&seed=86000042#play)

**Wednesday waiting cost a delivery.** On Friday-switch seed 86000079 both dispatchers booked Inland to Harbor on Wednesday afternoon. RL kept its spare truck at Junction and earned 31, while the planner paid to move it to Inland and earned 15. Thursday morning brought an Inland contract. RL running from its own placement earned 4 and missed the contract. From the planner’s placement it earned 64 and served the contract. The 16 credits saved on Wednesday cost 60 on Thursday. Both branches then arrived at the same locations. Their weekly totals were 420 and 464, the same 44-credit gap seen between the complete policies. [Play this week](https://arhaan2.github.io/evalsim-dispatch/fleetweek.html?family=friday-switch&seed=86000079#play)

To select the two cases, take weeks whose first differing move falls on Monday–Thursday afternoon and changes the unordered ending positions. Keep weeks where the isolated choice effect has the same sign as the complete-policy difference. Within the 233 positive and 284 negative examples, choose the margin closest to each group’s median, breaking ties by manifest order. These cases illustrate the mechanism. The full-bank estimates above quantify its typical payoff.

## Variation across training runs

All five fits were completed before either validation or test was scored. Each row evaluates the same 2,048 fresh weeks. Fit 13 was designated in advance. All five point estimates were below the planner.

| Fit seed | Net credits per week | On-time contracts | Net vs planner [95%] | On-time vs planner, percentage points [95%] |
|---:|---:|---:|---:|---:|
| 13 | 339.73 | 74.20% | −2.67 [−4.60, −0.79] | −0.635 [−1.001, −0.273] |
| 37 | 339.94 | 74.25% | −2.46 [−4.39, −0.60] | −0.586 [−0.942, −0.229] |
| 73 | 339.07 | 74.03% | −3.33 [−5.27, −1.33] | −0.811 [−1.172, −0.439] |
| 101 | 340.79 | 74.58% | −1.61 [−3.51, +0.28] | −0.259 [−0.615, +0.093] |
| 211 | 340.29 | 74.32% | −2.11 [−4.07, −0.10] | −0.522 [−0.908, −0.137] |

The intervals use 2,000 paired bootstrap samples stratified by market, preserving each full week and the four schedule weights. They describe uncertainty over weeks under these synthetic schedules for a fixed checkpoint. The five fit rows quantify training variation separately. [Protocol and fixed split definitions](./PROTOCOL.md)

## Training

The experiment fixes five fit seeds (13, 37, 73, 101 and 211) and designates 13 as the release before evaluation. Each fit samples 768 complete training weeks from each of seven synthetic market schedules. It uses a separate block of 5,376 week seeds starting at 70,000,000 plus 100,000 times the fit index. Thus the five checkpoints use 26,880 distinct weeks. The explorer samples a legal joint action uniformly at each of the ten half-days. The public freight board evolves independently of those actions, while truck locations and earnings respond to them.

For each observed board the trainer enumerates legal rewards and destinations from each possible truck placement, including placements the explorer did not visit on that particular week. This expansion is possible because positions are the only truck state carried to the next board. Two actions that leave the same pair of locations have the same future options. For training, the better immediate net reward of such actions suffices. The simulator provides these public outcomes on train-only weeks. The trainer never requests the planner's actions or labels.

The finite-horizon fitted Q update works backward from Friday. For each week and possible position pair, the target is the best legal net reward on the next sampled board plus its previously fitted continuation value. The next board is an observed training transition. Subtracting the mean target across all six position pairs removes the board's common earnings level and preserves the relative value of a move. A ridge regression estimates those contrasts from the current observation. Each stage uses a separate six-output fit, an unpenalized intercept, a ridge penalty of 0.001 per sample, unit discount and eight-decimal coefficients. The checkpoint contains nine fitted regressions and a zero terminal value.

The 59 features summarize the current hub, recent observed hubs, Monday's public forecast across all ten half-days, and agreement between observed and forecast hubs. The inputs exclude the week seed, market family, future realized hub and future signed freight. Deployment uses the known reward of each currently legal move and one inference pass. The planner, greedy baseline and learned policy break exact value ties by favoring a served contract and then fewer empty miles. [Learner source](./fit.mjs) · [Inference policy](../../docs/lib/fleetweek-policy.js)

## Comparators

The greedy baseline maximizes the current half-day's net earnings. The stochastic planner forecasts the remaining hubs using the Monday bulletin, a Markov persistence prior, and observations up to the current board. It integrates possible signed offers and computes the best continuing legal decision for each future board, tracked by hub and fleet positions. Both the learning and planning policies can empty-reposition a truck, take spot freight, serve a due contract or wait. Each missed contract costs 34 credits. Loaded and empty moves incur their posted travel costs. The primary outcome is weekly net credits and the predeclared service comparison uses the fraction of ten due contracts served. [Planner and greedy policies](../../docs/lib/fleetweek-planner.js)

## Reproduce the evidence

From the repository root, run the following commands with Node.js 22 or later. The first re-fits all five checkpoints, regenerates the reference dispatches and checks the published result files. The second independently reconstructs weekly ledgers and checks the comparisons.

```sh
npm run audit:fleetweek
npm run audit:fleetweek:ledgers
```

An independent fit check also regenerated the 26,880 training weeks using an always-wait policy to observe the same exogenous freight. It scored every individual legal move to rebuild 1,451,520 position-specific Bellman targets and substituted the released coefficients into each ridge normal equation. The largest absolute mean gradient after the registered ridge penalty was below 1.7 × 10⁻⁸, consistent with eight-decimal stored coefficients. [Benchmark your own dispatcher](../../FLEETWEEK.md) · [Five published fit checkpoints](../../docs/data/fleetweek/)
