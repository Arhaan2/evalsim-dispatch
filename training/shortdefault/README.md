# Learning when to switch from the short-trained fleet policy

Each fleet faces the same five-day sequence of freight boards and repair notices. The dispatcher starts with the published policy fitted on one- to three-half-day repairs, called the short policy. A second frozen policy learned on a mix that included four- and five-half-day repairs. When these policies choose different actions, the new dispatcher estimates the change in Friday earnings and service from taking the long policy’s action. Its unit of decision is one paired truck assignment on the current board. [Registered protocol and source](https://github.com/Arhaan2/evalsim-dispatch/tree/9ec4f2ef36b6d61134625bc959d52dca3a137935/training/shortdefault) · [Two frozen policies](../longrepair/README.md)

## Counterfactual training targets

On each training tape the two branches take their respective first action, then both follow the frozen short policy through Friday. A week’s net credits include contract penalties and both loaded and empty travel costs. One more on-time contract contributes one unit to the service target. The two training responses are the long branch’s final credits and contracts served minus the short branch’s values. All examples come from actual disagreements. Although the two moves always have the same signed freight on the decision board, their resulting truck positions can change later loads, travel costs and missed contracts.

The trainer considers six canonical starting depot pairs, including off-path placements. A backward recurrence computes the exact short-policy continuation for all nine ordered placements because truck IDs affect ties. The deployed agent can reconsider its choice on later boards. Each training row labels one action followed by the frozen short policy. A benchmark week measures the return of a policy acting repeatedly from the Monday start. [Training implementation](fit.mjs)

## What the agent sees

The two original policies share a closure-versus-constant proposal. They can disagree in either direction. When the long policy chooses the constant-penalty move, the new gate reverses the sign of every action-oriented input and of its prior credit and service estimates. All 49 inputs are available to the public dispatcher. They include an intercept, 43 signed features of current freight, depot coverage, repair bulletins, elapsed time and forecasts, an explicit direction flag and the credit/service estimates from both frozen policies. The prior for each head is the signed arithmetic mean of those two estimates. [Policy implementation](../../docs/lib/shortdefault-policy.js)

Each head fits the realized Friday advantage minus its prior using ridge regression on standardized inputs. The intercept is unpenalized and the penalty is 0.05 per example on every other coefficient. A separate calibration bank fits the mean response, prediction mean and least-squares slope clipped to [0, 1.5]. The constant-score control substitutes the calibration means for both predictions while keeping the release’s selected settings.

A switch requires the predicted credit gain to exceed the selected hurdle. The credit gain plus the service gain times a contract price must independently exceed the same hurdle. The twelve candidates combine hurdles of 0, 2, 5 or 10 credits with contract prices of 0, 12 or 30 credits. The thirteenth policy always takes the short action. Every configuration dispatches a full fleet on every selection week. To replace the short default, the mean paired credit gain minus one standard error must be positive and the mean paired service change must be nonnegative. Among qualifying configurations, selection takes the largest credit gain minus one standard error. Ties use the registered grid order. If none qualify, selection deploys the short default.

## Training banks

| Bank | Weeks per family | Total weeks per fit | What it determines |
|---|---:|---:|---|
| Fitting | 4,096 | 45,056 | Board-dependent credit and service advantages |
| Calibration | 1,024 | 11,264 | Prediction means and slopes |
| Selection | 2,048 | 22,528 | Contract price, switch hurdle or short-only policy |

Each bank uses eleven historical training freight schedules, morning closure starts at half-days 2, 4 or 6 (Monday morning is zero), and durations sampled uniformly from [1, 2, 3, 4, 4, 5, 5]. Friday close ends the episode even if a repair continues. The five fits have independent tape seeds. Numbering fits 13, 37, 73, 101 and 211 from index zero, their seed blocks start at 700,000,000 plus 1,000,000 times the index. Calibration and selection offsets are 200,000 and 400,000. Within each bank, each family consumes the next contiguous block of its stated size. Fit 13 was designated for release before training.

## Reproduce

The trainers use Node.js built-ins, public frozen weights and the simulator. The reference runs used Node.js 24.18.0 on an Apple M4 Pro CPU (macOS arm64). Run these commands from the repository root.

```sh
node training/shortdefault/fit.mjs --check
node training/shortdefault/audit-fit.mjs
```

The first command refits all checkpoints and compares every output byte. The second computes both counterfactual outcomes through literal forward dispatch, reconstructs both orientations of the published policies, checks the ridge normal equations and calibration parameters, and replays every complete selection week for all 13 candidates. Either command accepts a single registered seed as its last argument. [Independent audit](audit-fit.mjs) · [Fresh-week study and benchmark](../../SHORTDEFAULT.md)

## Selection results

| Fit | Fitting disagreements | Long chose the closure proposal | Calibration pairs | Credit slope | Service slope | Selected policy | Switches over 22,528 weeks |
|---|---:|---:|---:|---:|---:|---|---:|
| [13](../../docs/data/shortdefault/fit-13.json) | 3,693 | 2,340 | 897 | 0.596 | 0.945 | Always short | 0 |
| [37](../../docs/data/shortdefault/fit-37.json) | 3,526 | 2,197 | 936 | 0.126 | 0.858 | Always short | 0 |
| [73](../../docs/data/shortdefault/fit-73.json) | 3,557 | 2,249 | 922 | 1.143 | 0.788 | Hurdle 2, service weight 0 | 50 |
| [101](../../docs/data/shortdefault/fit-101.json) | 3,534 | 2,305 | 847 | 0.489 | 0.823 | Always short | 0 |
| [211](../../docs/data/shortdefault/fit-211.json) | 3,571 | 2,240 | 909 | 0.494 | 1.113 | Hurdle 2, service weight 12 | 10 |

In release fit 13, the long move earned 1.004 more credits on average across 897 calibration disagreements, including placements outside normal play. On the separate full-week selection bank, the best mean earnings gain from an active candidate was 0.0064 credits per week. That candidate switched 116 times in 22,528 weeks. Its paired mean minus one standard error was −0.0104 credits. All twelve candidate settings matched or improved mean service relative to short on these selection weeks. Nine switched at least once. None of the twelve cleared the registered earnings criterion. The release therefore follows the frozen short policy on every board, including boards where the learned heads predict a positive gain. The release and its constant-score control behave identically by construction.

The two secondary fits that selected active policies passed the training guard with small margins. Fit 73 switched 50 times and cleared zero by 0.00012 credits per week after subtracting one standard error. Fit 211 switched 10 times and cleared zero by 0.00184. Fit 13 remained the designated release across all tests.

All five checkpoints reproduced byte-for-byte in a separate, clean export of the weights commit. The independent audit confirmed both orientations of the Friday targets, the fits and calibration estimates, and all 65 whole-policy selection entries. The largest per-row ridge optimality residual was 2.26 × 10⁻⁸. [Frozen checkpoints](https://github.com/Arhaan2/evalsim-dispatch/tree/ba00d572f515e3c4107a27b73264577c198c0ff4/docs/data/shortdefault)
