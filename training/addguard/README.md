# Training the continuation of fit 73

This is counterfactual Monte Carlo policy improvement in the five-day DISPATCH simulator. The two expert dispatchers and their parent policy are frozen. The new model learns an action value from Friday outcomes on simulated branches; a threshold turns its predictions into a veto. The learner receives the public board and repair forecast during play.

## Follow one training example

1. Sample a training week with one of the eleven historical demand patterns. During fitting, consider each of six physical truck placements on a warning or closure board before Friday afternoon. Keep a row when fit 73 chooses a long move it added over move-recall.
2. Compare taking that long move now with taking short now. Both branches then follow short through Friday on the same realized freight and repair updates. Preserve truck order on each branch. Label the pair with net credit and on-time contract differences. Winning and losing labels require strictly positive and negative credit differences.
3. Compute the 28 public inputs. The new features compare the trucks' projected positions on the same possible next freight board with the depot open or closed. They include the predicted downside of lost freight and the chance that one placement sacrifices contract coverage. The model also receives the frozen parent's forecasts.
4. Fit five ridge regressions on the paired examples. Independently calibrate the heads using natural short-policy placements, then evaluate seven veto settings on separate selection weeks. Every setting keeps all the parent’s other decisions. Publish the full selection table even when the fallback wins. [Feature definitions](../../docs/lib/addguard-policy.js) · [Training code](fit.mjs) · [Selection and sampling protocol](PROTOCOL.md)

Fit IDs distinguish independent simulation seeds. All three start with the *same* frozen switch-cost fit 73. The preregistered primary continuation also has training ID 73. The study uses 180,224 fitting, 90,112 calibration and 180,224 selection weeks per fit. Enrichment increases the number of eligible additions available for learning. All fresh decision and economic metrics use the natural fleet starting positions.

## Reproduce the release

The original runs used Node.js 24.18.0 on an Apple M4 Pro CPU, macOS 26.6.2 arm64. The JavaScript experiments require no external packages. From the repository root, reproduce one model and audit its paired returns, calibration and rule selection:

```sh
node training/addguard/fit.mjs --check 73
node training/addguard/audit-fit.mjs 73
```

Use fit IDs 101 and 211 to repeat the checks for the other continuations. Check the published evaluations and pages:

```sh
npm run audit:addguard:study
npm run audit:addguard:ledgers
```

The first command reproduces the fresh banks, the separate replay of the six historical losses, the exploratory runner-up comparison and the generated study material. The ledger audit rebuilds routes and scores from the public simulator. The bootstrap intervals describe variability across new simulated weeks on the specified schedules. The historical replay answers what the frozen models would do in the original 24 cases and is kept separate from the nine fresh-week tests. [Benchmark your own dispatcher](../../ADDGUARD.md) · [Exploratory comparison](SENSITIVITY.md)
