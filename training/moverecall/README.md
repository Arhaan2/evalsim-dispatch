# Learning which skipped fleet moves to recover

The two candidate dispatchers carry the same signed loads and can choose different empty moves. One was fitted on short repairs, the other on a mix including long repairs. The prior long-move detector already switches between them. This experiment preserves every long move that detector takes. On a disagreement it declines, the new policy retrieves similar cases from training and estimates the Friday value of taking the long move. [Frozen training and scoring protocol](https://github.com/Arhaan2/evalsim-dispatch/tree/9f2e70968be9a5f6b209f3a3fefad53c882fd9ce/training/moverecall)

## Which cases enter the model

The trainer drives the short dispatcher from Monday’s standard truck placement on each new fitting week. A board contributes one case only when the short and long policies disagree and the frozen detector still chooses short. On that exact ordered placement, one branch takes the short action and one takes the long action. Both dispatch the remaining boards using the short policy. Subtracting the two final ledgers gives long-minus-short net credits and on-time contracts. A strict win earns more Friday credits than short. A tie counts as a nonwin. Each stored case has unit weight. [Simulator training code](fit.mjs)

At inference, the policy evaluates the frozen detector at the fleet positions it actually reaches. Any previous long decision is retained, even under the flat ablation or the no-rescue fallback. Preserving decisions at the same position allows later trajectories to diverge once the new policy makes its first rescue. In evaluation, paired complete weeks measure the effects of those later decisions. A separate comparison holds the short-policy path fixed to count how many original misses are recovered.

## Learning a neighborhood

Each case records 58 observable inputs. Fifty-four describe the disagreement, public repair and freight information and projected next-board opportunities. The final four come from the frozen detector’s predicted win probability, net gain, unconditional downside and service change. A fitting-bank mean and standard deviation standardize each input. Values are clipped to four standard deviations in either direction and stored in units of 1/32 of a standard deviation. A constant feature uses scale one.

The trainer groups each feature’s recorded values at up to seven empirical octile cut points. For each of four responses it calculates how much of the response’s total variation lies between the feature bins. The responses are the strict-win indicator, net gain, credit shortfall and service change. The metric weight is 0.02 plus twice the explained share of the win indicator plus each of the other three explained shares. The doubled weight makes the retrieval distance particularly sensitive to distinctions between wins and nonwins. The fit does not use benchmark families, held-out cases or their labels. [Public inference code](../../docs/lib/moverecall-policy.js)

On a skipped disagreement, the policy retrieves the 64 lowest weighted squared distances using the learned feature weights. Distance ties favor the earlier fitting case. The four neighborhood means shrink toward their respective fitting-bank means with the weight of 16 additional cases. A disjoint calibration bank then fits an intercept and a centered least-squares slope clipped to [0, 1.5] for each response. Win probabilities are clipped to [0.005, 0.995] and estimated downside has a floor of zero. The flat ablation replaces the four calibrated neighborhood predictions on skipped disagreements with their calibration target means.

## Choosing when to rescue

Eighteen candidate thresholds combine win-probability floors of 0.30, 0.40 or 0.50, credit hurdles of −2, 0 or 2, and downside penalties of 0 or 0.10. Each rule adds 12 credits per predicted additional contract served to its net earnings forecast, then subtracts the downside penalty times the predicted expected credit shortfall. A rescue requires the probability to meet the floor and the score to exceed the hurdle. The nineteenth option always follows the previous detector.

Every candidate controls its own fleet through each full selection week. To qualify, it must earn a strictly positive mean credit gain over short after subtracting one paired standard error, maintain or improve mean service versus short, maintain or improve mean credits versus the previous detector, and recover at least one profitable previous skip on the matched short path. Selection maximizes added profitable captures among qualifying candidates. Ties go to the larger paired earnings bound over short, then to the earlier registered candidate. If none qualify, deployment keeps the prior detector.

## Sampling and reproduction

| Bank | Weeks per historical freight family | Weeks per fit |
|---|---:|---:|
| Fitting | 16,384 | 180,224 |
| Calibration | 4,096 | 45,056 |
| Selection | 8,192 | 90,112 |

The eleven historical families each draw closures starting at half-day 2, 4 or 6, counting Monday morning as zero. Repair duration is sampled uniformly from [1, 2, 3, 4, 4, 5, 5]. A Friday close cuts off both branches. Independent fits use seeds 13, 37, 73, 101 and 211. Fit 13 is the designated release. Each fit uses a block beginning at 900,000,000 plus one million times its zero-based index. Calibration and selection begin at offsets of 250,000 and 500,000. Each subsequent family starts one per-family count later within the bank.

The reference implementation runs on CPU using Node.js built-ins. These checkpoints used Node.js 24.18.0 on an Apple M4 Pro running macOS arm64. From the repository root, run the commands below. Either accepts an optional final argument with one registered seed.

```sh
node training/moverecall/fit.mjs --check
node training/moverecall/audit-fit.mjs
```

The refit compares the five complete checkpoint files byte-for-byte. The independent audit reconstructs every archived observation, both Friday returns, every standardized feature and dimension weight, and all calibrations. It sorts the entire case archive by distance as a separate implementation of neighbor retrieval. Finally it replays the full candidate fleet paths and the common-path captures and recomputes the selected rule. [Independent training audit](audit-fit.mjs) · [Public agent benchmark](../../MOVERECALL.md)

## Selected policies

| Fit | Fitting cases | Calibration cases | Profitable prior skips on selection | Added wins / ties / losses on the matched path | Full-week rescues | Selected rule |
|---|---:|---:|---:|---|---:|---|
| [13](../../docs/data/moverecall/fit-13.json) | 1,627 | 359 | 374 | 244 / 50 / 157 | 451 | Probability ≥ 0.30, hurdle 0, downside penalty 0.10 |
| [37](../../docs/data/moverecall/fit-37.json) | 1,617 | 424 | 351 | 308 / 69 / 243 | 622 | Probability ≥ 0.30, hurdle -2, downside penalty 0.00 |
| [73](../../docs/data/moverecall/fit-73.json) | 1,566 | 422 | 373 | 128 / 6 / 73 | 208 | Probability ≥ 0.50, hurdle 0, downside penalty 0.00 |
| [101](../../docs/data/moverecall/fit-101.json) | 1,599 | 401 | 352 | 0 / 0 / 0 | 0 | Prior only |
| [211](../../docs/data/moverecall/fit-211.json) | 1,644 | 429 | 397 | 388 / 119 / 283 | 788 | Probability ≥ 0.30, hurdle -2, downside penalty 0.00 |

Release fit 13 recorded 1,627 previously skipped training cases, including 731 wins, 291 ties and 605 losses. Its separate calibration bank contained 359 cases. The direct net-credit calibration slope clipped to zero, producing the same +0.691-credit earnings forecast for every skipped board. Win probability, expected downside and service still vary with the retrieved cases. Their calibration slopes were 0.824, 0.675 and 0.925, respectively. The flat ablation’s win probability is 0.474 and its score is +0.277 credits, clearing both release thresholds on every skipped board. It therefore follows the long-trained dispatcher on every disagreement.

Twelve active candidates qualified on fit 13’s 90,112 selection weeks. The selected rule recovered 244 of 374 profitable old skips (65.2%) on the matched path, while accepting 157 losing moves and 50 ties. In its complete fleet trajectories it earned +0.00948 credits per week over short (+0.00065 after subtracting one paired standard error) and +0.00802 credits per week over the prior detector. These numbers describe model selection. The public study scores the frozen models on new weeks. [Frozen checkpoints before fresh scoring](https://github.com/Arhaan2/evalsim-dispatch/tree/d593b0dbaeec6f4f9a4b26d7ce70849f30dad483/docs/data/moverecall)
