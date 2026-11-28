# Learn when to protect a Friday delivery

At the public closure warning the fleet can follow positioning fit 101, positioning fit 211 or original switch-cost fit 73. Each action can move both trucks, serve current freight or wait. The policies may all propose the same move. A different choice can change the location of either truck on both Friday boards.

## How the policy learns

The simulator pairs each distinct alternative with the default fit 101 move on the same training week. All branches use the frozen switch-cost dispatcher after the warning. The agent receives Monte Carlo estimates of the difference in return through Friday. The three return components are Friday contracts, full-week contracts and full-week net credits. Identical decisions produce no training row. A week with two distinct alternatives contributes two rows.

The trainer fits one shallow boosted-tree model per return component. It selects the weights and hurdle for overriding fit 101 from 27 combinations on separate weeks. When dispatching, the agent sees the trucks, freight, public closure warning and forecasts. It can evaluate the frozen dispatchers’ proposed actions using these inputs. The realized freight and repairs used to build training labels arrive after the real decision.

Each checkpoint contains its training seed, frozen reference hashes, feature names, fitted trees, chosen settings and all 27 selection outcomes. The primary and both independently trained alternatives have their own learning and selection draws. The primary seed was fixed before training. [Registered training and evaluation protocol](PROTOCOL.md) · [Public decision function](../../docs/lib/fridayguard-policy.js) · [Trainer](fit.mjs)

## Reproduce and inspect

With Node.js 22 or newer, run these commands from the repository root. The experiment uses CPU simulation without a paid service or external model download. The release was produced with Node.js 24.18.0.

```sh
node training/fridayguard/fit.mjs --check 73
node training/fridayguard/audit-fit.mjs 73
npm run audit:fridayguard:study
npm run audit:fridayguard:ledgers
```

Repeat the first two commands for seeds 101 and 211 or use `npm run audit:fridayguard:fits` to check all three. The model audit independently reconstructs the two branches of actual learning and selection disagreements using the simulator. The ledger audit recomputes the public decisions, contract identities, weekly ledgers, comparisons and paired confidence intervals. The study audit regenerates the prior-bank 39-miss and 35-save attribution and measures achievable gains within the three permitted warning actions. [Hindsight diagnostic](DIAGNOSTICS.md) · [Benchmark an external agent](../../FRIDAYGUARD.md)
