# What does it cost to reverse a fleet decision?

A long empty move can win on Friday earnings, lose, or break even. The previous rescue policy took some long moves the original detector skipped. This experiment asks whether a dispatcher can veto damaging rescues and replace any profitable ones it gives up with valuable moves from the remaining skips. The original detector’s long approvals are protected. [Protocol and frozen training code](https://github.com/Arhaan2/evalsim-dispatch/tree/e19284bcd1833835cd9b44fe74b03a9583f23509/training/switchcost)

## Where the labels come from

Drive the frozen short dispatcher from Monday’s standard placement on a new synthetic week. Each disagreement that the original long-move detector skips contributes one example at the actual ordered truck positions. Some of these examples are moves that the subsequent rescue policy would take. The others are moves it would still decline. Both groups enter the fit with one example per board.

For each example, both trucks first take the frozen short or long action on separate branches. The branches then follow the identical short-policy rule over the same sequence of freight and repair notices through Friday close. Subtracting the two Friday ledgers gives the change in net credits and the change in on-time contracts. Moving long may change which freight the fleet can reach later. Ties have zero upside, zero downside, and contribute to neither strict event. [Paired simulator replay](../moverecall/fit.mjs) · [Fitting implementation](fit.mjs)

## Estimating the costs of both choices

Five ridge-regression heads estimate a strict loss probability, strict win probability, unconditional downside credits, unconditional upside credits, and additional contracts served. The targets for downside and upside are the negative and positive parts of the paired net change, respectively. Their predicted difference is expected net credits.

The 23 inputs include an intercept, both predecessor policies’ forecasts, the rescue policy’s score, the observed age of the closure, remaining time, and public estimates of next-board contract coverage and earnings after each move. An indicator records whether the rescue policy accepted the long move. Four interactions with that indicator let the relationship between its forecasts and realized returns differ between earlier rescues and remaining skips. Every input is observable at decision time.

The trainer standardizes each non-intercept input on the fitting bank. Ridge regularization is 0.10 per row, with the intercept unpenalized. Each head receives its own prediction mean, target mean and centered least-squares calibration slope clipped to [0, 1.5] on separate calibration weeks. Upside and downside credit estimates have a floor of zero. The two strict-event probabilities are clipped to [0, 1]. If their sum exceeds one, the model scales them proportionally to sum to one. Any remaining probability represents a tie.

The ranking score starts with predicted net earnings, adds 12 credits per additional on-time contract and six credits times the strict win probability, and subtracts 12 credits times the strict loss probability. The event terms give a loss or win a separate decision cost alongside its monetary size. These weights rank actions. The actual weekly ledger uses the original simulator rewards. [Public inference code](../../docs/lib/switchcost-policy.js)

## When to veto and when to add a long move

On calibration weeks, the trainer ranks the actual earlier rescues and the still-skipped moves separately. A candidate vetoes a bottom fraction of the earlier rescues and accepts a top fraction of the remaining skips. Veto fractions are 0, 5%, 15%, 30% and 50%. Add fractions are 0, 5%, 15%, 35% and 60%. Cutoffs use the nearest-rank empirical quantile. Zero disables a side. A tie at either cutoff keeps the earlier action. The flat control uses the calibration target means on every editable board and the same two learned cutoffs.

All 25 combinations control their own fleets on disjoint selection weeks. A matched short path separately measures how many actual winning, losing and tied long moves each rule vetoes and adds. An active rule must meet every condition below.

- Its vetoes prevent more losing switches than its additions introduce.
- The vetoed long moves together would have lost credits. Avoiding them has strictly positive realized value.
- Its additions replace at least as many profitable long moves as its vetoes give up.
- Its mean on-time service is at least as high as both the previous rescue policy and short.
- Its mean weekly earnings exceed the previous rescue policy’s. Its gain over short also remains positive after subtracting one paired standard error.

Among qualifying rules, selection first maximizes the number of losing switches eliminated after accounting for new losses, then the mean weekly earnings gain over the previous rescue policy. Exact ties retain the earlier candidate in the registered grid. If none qualify, both sides are disabled and the previous rescue policy is deployed. The trained cost estimates still exist for editable boards. The original detector’s protected longs always stand, including under the flat control.

## Reproduce the study

| Bank | Weeks per historical freight family | Weeks per fit | Purpose |
|---|---:|---:|---|
| Fit | 16,384 | 180,224 | Learn the five cost and service heads |
| Calibration | 4,096 | 45,056 | Calibrate predictions and compute the two sets of cutoffs |
| Selection | 8,192 | 90,112 | Measure captures, lost switches, service and earnings for every rule |

The eleven historical families use closure starts in half-days 2, 4 or 6, with Monday morning numbered zero. Durations are drawn uniformly from [1, 2, 3, 4, 4, 5, 5]. All rewards stop at Friday close. Fits 13, 37, 73, 101 and 211 use independent tape seeds. The designated release is fit 13. The fitting banks begin at 1,000,000,000 plus one million times the fit’s zero-based index. Calibration and selection use offsets of 250,000 and 500,000. Within a bank, each subsequent family starts one per-family count later.

The CPU reference runs used Node.js 24.18.0 on an Apple M4 Pro running macOS arm64. Run these commands from the repository root. Either command accepts a single registered seed as its final argument.

```sh
node training/switchcost/fit.mjs --check
node training/switchcost/audit-fit.mjs
```

The first command refits all five complete checkpoint files and checks for byte equality. The independent audit reconstructs short-policy suffixes recursively using ordered truck positions. It rebuilds the loss, win, severity and service outcomes, checks the ridge normal equations, recomputes all calibration parameters and group quantiles, and reconstructs the selection ledger, accounting for both sides of every change. [Independent audit](audit-fit.mjs) · [Public benchmark](../../SWITCHCOST.md)

## What each fit selected

| Fit | Fitting cases | Prior rescues in fit | Calibration cases | Qualifying settings | Selected veto / add fractions |
|---|---:|---:|---:|---:|---|
| [13](../../docs/data/switchcost/fit-13.json) | 1,584 | 870 | 371 | 0 | Keep previous policy |
| [37](../../docs/data/switchcost/fit-37.json) | 1,600 | 918 | 417 | 0 | Keep previous policy |
| [73](../../docs/data/switchcost/fit-73.json) | 1,589 | 891 | 401 | 1 | 15% / 15% |
| [101](../../docs/data/switchcost/fit-101.json) | 1,690 | 921 | 397 | 0 | Keep previous policy |
| [211](../../docs/data/switchcost/fit-211.json) | 1,640 | 927 | 403 | 0 | Keep previous policy |

Release fit 13 learned from 551 losing moves, 747 winning moves and 286 ties in its fitting bank. It encountered 821 editable boards on the separate 90,112-week selection bank. On that path the previous rescue policy accepted 211 winners, 180 losers and 57 ties. Of the 24 alternative rules, 11 reduced total losing switches after accounting for newly added losses, and 10 preserved or increased the number of winners taken. No alternative achieved both. Each also missed at least one of the two service requirements and at least one earnings requirement. The release consequently retains all the previous policy’s actions. Its calibrated loss, win, upside, downside and service forecasts remain available for inspecting editable boards.

Seed 73 was the only fit to select an active rule. On its own matched selection path, the rule vetoed 30 losses, 15 wins and 15 ties, then added 29 losses, 18 wins and 11 ties. It finished with one fewer loss and three additional profitable captures, alongside +0.00706 credits per full week versus the previous rescue policy. The selected cutoffs were −4.5834 credits for vetoes and −3.3877 credits for additions in their respective groups. This is a secondary training-selection outcome. All five fits retain their registered identities in the fresh evaluation.

Each initial fit finished in 135–138 seconds of wall time with all five running concurrently on the reference Mac. [Weights frozen before fresh scoring](https://github.com/Arhaan2/evalsim-dispatch/tree/6e621377ec556ead68fdc7049f992360eee6361e/docs/data/switchcost)
