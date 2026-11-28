# Learn a warning-time position

The fleet encounters one public warning per closure week. It can use both trucks to serve current freight, move empty, or stay put. The value of the resulting positions depends on freight and repair updates that have not arrived yet.

## A Friday return for each first move

Follow frozen switch-cost fit 73 from Monday until the warning. For every legal first action, let fit 73 dispatch both trucks from the resulting positions through Friday on identical freight and repair draws. Record immediate payoff and remaining net credits and signed deliveries. Cache the nine ordered truck-position suffixes per week. Together they provide returns for every legal warning action.

The policy learns relative values for six physical arrangements. Each arrangement contributes one row per training week. Different orderings of the same two depots contribute their average to the fitting label. Evaluation always follows the order produced by the actual chosen action. The model uses public repair and demand information, the next board's possible freight, forecast depot coverage, time remaining and the rolling planner’s continuation value. Two ridge regressions fit credit residuals and signed-contract value. Each decision combines the immediate action with the estimated continuation.

Selection evaluates fifteen service weights and override hurdles on separate weeks. The simulator always charges the same real missed-contract penalty. The training service weight changes what the dispatcher chooses. All fits share the same simulator and frozen fit 73; each has its own training and selection draws. [Protocol](PROTOCOL.md) · [Public runtime and feature definitions](../../docs/lib/preposition-policy.js) · [Counterfactual trainer](fit.mjs)

## Reproduce the experiment

The training ran on an Apple M4 Pro CPU with Node.js 24.18.0. There are no runtime package dependencies. From the repository root, reproduce and audit one checkpoint:

```sh
node training/preposition/fit.mjs --check 73
node training/preposition/audit-fit.mjs 73
```

Repeat for IDs 101 and 211. To check the fresh evaluation, challenge outcomes and public report, run:

```sh
npm run audit:preposition:study
npm run audit:preposition:ledgers
```

The study reports delivery and credit differences on the same complete simulated weeks. Bootstrap intervals describe within-schedule variability. Friday morning and afternoon each have a distinct signed contract. The challenge replays both routes from the same warning and uses the same frozen dispatcher for every later choice. [Benchmark your own dispatcher](../../PREPOSITION.md)

## What changed the dispatch?

Two retrospective checks help interpret the differences between fits. The primary intervened on eight selection weeks, all on afternoon warnings. It intervened on zero of the 4,805 selection warnings at the three morning times used on the fresh bank. Warning time is one plausible explanation for its lack of fresh interventions. [Selection timing and contract counts](../../docs/data/preposition/fit-deliveries.json)

For each fit, the second check sets both learned regressions to zero while keeping the same planner inputs, service weight and override hurdle. Fits 101 and 211 delivered 78 and 47 extra contracts respectively against their own controls. These comparisons are supplementary to the four registered primary outcomes. [Matched controls and paired intervals](../../docs/data/preposition/matched-controls.json) · [Pretest diagnostic plan](DIAGNOSTICS.md)
