# What happens when the freight forecast lags the market?

DISPATCH Drift retains the eight offers and two truck slots from Freight Reserve. The chance of a high-paying offer changes during a shift. Dispatchers receive an opening forecast, two delayed survey updates, the current signed offer, and the complete public history. The simulator fixes the underlying offers before anyone acts. [Play Drift](https://arhaan2.github.io/evalsim-dispatch/drift.html) · [Benchmark your agent](../../DRIFT.md)

## Results on three unseen patterns

The released Q-learning policy earned **46.49 net credits per shift** and the original Reserve distribution planner earned **46.22**. The mean paired difference was **+0.27** credits, with a 95% bootstrap interval from **−0.43 to +0.95**. The aggregate comparison is inconclusive. Each family contributed exactly 256 shifts. A different mix of these patterns would change the aggregate.

| Pattern | Drift Q | Distribution planner | History-adjusted planner | Frozen Reserve Q | Drift Q minus distribution planner, 95% interval | Wins / ties / losses |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Reversal | 39.19 | 51.29 | 44.82 | 24.34 | −12.10 [−13.70, −10.48] | 56 / 35 / 165 |
| Double pulse | 53.03 | 51.58 | 50.09 | 24.34 | +1.45 [+0.25, +2.66] | 109 / 113 / 34 |
| Interrupted drop | 47.24 | 35.78 | 39.35 | 31.65 | +11.46 [+9.79, +13.18] | 140 / 67 / 49 |
| All 768 shifts | 46.49 | 46.22 | 44.75 | 26.77 | +0.27 [−0.43, +0.95] | 305 / 215 / 248 |

On reversal shifts, a hot market cooled before closing. The learned policy kept a slot until the last wave on 194 shifts, while the distribution planner did so on 26. On interrupted drops, the planner booked the final wave on 213 shifts and the learned policy did so on 60. The two policies respond differently to the same stale bulletin.

The original **distribution planner** recomputes its dynamic program each wave with the published probabilities. That calculation was exact in the original simulator. Drift's delayed and noisy forecasts make the model assumption imperfect. The **history-adjusted planner** applies a recency-weighted correction based on public forecast errors before solving the same dynamic program. The learned policy averaged **+1.73** credits over this second comparator [95% paired interval +0.98 to +2.50]. Both planners use the same signed offers, public forecasts and action constraints as participants. A planner with a different observation or revision model may score differently.

The **frozen Reserve Q** operator is the unmodified tabular checkpoint from the previous lab. Its table recognized zero of its 1,536 observations with capacity remaining, so its published first-fit fallback accepted both opening loads. Drift introduces different price supports and forecasts as well as new demand shapes. The zero-shot result reflects all of those changes together.

## How wrong were the forecasts?

The survey updates before waves 4 and 7 use market conditions two waves earlier, with measurement noise. On the test split, the posted chance of a high offer differed from the simulator's contemporaneous probability by **34.71 percentage points** on average over 6,144 waves. Mean squared error against the realized high/low outcome (Brier score, lower is better) was **0.342** for the published probabilities and **0.155** for the simulator's generating probabilities. A probability is a forecast of repeated outcomes, so a single surprising load is insufficient to establish miscalibration. The probability discrepancy above uses the simulator's latent law only in the post-evaluation audit.

## Train, freeze, transfer

Each fit used 12,000 seeds per pattern for one-step increases, one-step decreases, upward ramps and downward ramps. That is 48,000 shifts and 384,000 simulator decisions per fit. The five independent fits used disjoint blocks of seeds from 8100000–8159999. Development used rising and falling plateaus on 8200000–8200063. The final test uses 8300000–8300255, each crossed with three previously unused probability paths that change direction. All splits share the same eight-wave horizon, two-slot action space, two price-support schedules and forecast mechanism.

Training used model-free, finite-horizon fitted Q-learning. Each exploration shift drew a booking probability uniformly between 0.10 and 0.90 and sampled from the legal choices. The trainer records each chosen action, public features, immediate change in net credits and next observation's features. Working backward through the eight waves, a ridge regression fits the observed reward plus the largest legal next-action Q estimate. Each wave, capacity and action has its own regression. Discount is one and the per-observation ridge penalty is 0.001. The 14 public features include signed net credits, future quoted prices and probabilities, today's forecast error, an exponentially weighted recent error and mean error so far. At inference the policy chooses the legal action with the higher fitted Q. The learner receives public observations and simulator rewards throughout training.

| Training seed | Validation mean | Held-out mean | Reversal | Double pulse | Interrupted drop |
| --- | ---: | ---: | ---: | ---: | ---: |
| 13 (released) | 51.70 | 46.49 | 39.19 | 53.03 | 47.24 |
| 37 | 51.62 | 46.55 | 39.34 | 53.03 | 47.27 |
| 73 | 51.68 | 46.53 | 39.29 | 53.03 | 47.26 |
| 101 | 51.43 | 46.64 | 39.69 | 53.05 | 47.19 |
| 211 | 51.51 | 46.48 | 39.32 | 53.01 | 47.12 |

With all Q values initially zero, the tie rule accepts the first two loads and averages 30.22 on validation. All five policies improved on those separate development patterns. The protocol selected seed 13 for publication before any test evaluation and uses final weights for every run. The primary endpoint is the released policy's mean paired difference from the original distribution planner. Intervals resample whole scenario seeds 2,000 times, preserving the three-pattern cluster at each seed and each policy's outcomes. They describe tape-to-tape uncertainty conditional on these patterns and the fitted model. The per-pattern intervals are descriptive and unadjusted for multiple comparisons. Reusing public tests to tune an agent requires new evidence for any subsequent generalization claim.

## Reproduction

Use Node.js 22 or later. The reference run used Node.js 24.18.0 on macOS arm64 CPU, without external dependencies.

```sh
node training/drift/run.mjs --check
node --test test/drift-policy.test.mjs
```

The first command refits the five policies and checks the released weights, all operators' per-shift scores, forecast diagnostics, summary statistics and source fingerprint. The second independently replays every published score through the simulator. [Fixed protocol](protocol.mjs) · [Training implementation](run.mjs) · [Public result artifact](../../docs/data/drift/results.json)
