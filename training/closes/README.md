# Does remembering offers help when a reversal can end hot or cold?

Every seed generates both endings of every fresh pattern. Each pair shares its opening market, price schedule, offer draws and survey noise. The closing branches separate after four or five waves and hold hot or cold for the final two. Before the fork, the two histories are identical. After the fork, the dispatcher can observe signed offers and delayed bulletins. A high offer can still turn up in a cold market. [Play the lab](https://arhaan2.github.io/evalsim-dispatch/closes.html) · [Benchmark your own agent](../../CLOSES.md)

## Fresh reversals

On 2,048 fresh reversals, the retrained agent beat the distribution planner by **0.61 net credits per shift** (paired 95% interval +0.34 to +0.88). Its advantage over the matched agent trained without history was **0.11** (−0.01 to +0.25). The history-free fit also beat the planner, by 0.50 (+0.21 to +0.78). The contribution from history to the pooled reversal score remains uncertain.

| Fresh shifts | Count | History RL | No-history RL | Distribution planner | History RL minus planner [95% interval] | History RL minus no-history RL [95% interval] |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reversals, hot close | 1,024 | 54.56 | 55.03 | 54.00 | +0.56 [+0.22, +0.88] | −0.47 [−0.61, −0.34] |
| Reversals, cold close | 1,024 | 44.88 | 44.19 | 44.22 | +0.66 [+0.15, +1.18] | +0.70 [+0.42, +1.01] |
| All reversals | 2,048 | **49.72** | **49.61** | **49.11** | **+0.61 [+0.34, +0.88]** | **+0.11 [−0.01, +0.25]** |
| Interrupted drops, hot close | 1,024 | 54.50 | 54.37 | 59.00 | −4.50 [−5.13, −3.85] | +0.13 [+0.03, +0.21] |
| Interrupted drops, cold close | 1,024 | 46.07 | 46.14 | 33.12 | +12.95 [+11.97, +13.93] | −0.07 [−0.19, +0.03] |
| All interrupted drops | 2,048 | **50.29** | **50.26** | **46.06** | **+4.23 [+3.63, +4.81]** | **+0.03 [−0.05, +0.10]** |
| All fresh shifts | 4,096 | 50.00 | 49.93 | 47.58 | +2.42 [+2.07, +2.76] | +0.07 [+0.01, +0.14] |

Within reversals, using history helped on cold finishes and hurt on hot finishes. The released agent won on two of the four reversal families on average against the planner. The planner led on the front-loaded hot crest and the delayed cold crest. The role of the clock also remains important for knowing how many offers are left and which price supports are coming.

## Interrupted-drop retention

The fresh interrupted-drop mix passed all three comparisons. Its aggregate advantage over the planner came from cold closes. The three archived checks used the original pattern generators on new seeds, all with cold endings. The first two passed. On the original interrupted-drop pattern, both earlier RL agents exceeded the new model by more than the one-credit tolerance across their entire paired intervals.

| Drop pattern | Shifts | History RL minus planner [95% interval] | Minus previous Turns RL [95% interval] | Minus previous Drift RL [95% interval] | Retained |
| --- | ---: | ---: | ---: | ---: | --- |
| Fresh hot/cold mix | 2,048 | +4.23 [+3.63, +4.81] | +1.25 [+0.93, +1.56] | +0.14 [−0.03, +0.30] | Yes |
| Archived early rebound | 512 | +16.34 [+15.11, +17.57] | −0.04 [−0.80, +0.71] | −0.57 [−0.97, −0.21] | Yes |
| Archived late rebound | 512 | +2.02 [+1.22, +2.82] | +0.97 [+0.33, +1.62] | +0.24 [+0.01, +0.45] | Yes |
| Archived original interrupted drop | 512 | +8.30 [+7.22, +9.37] | −2.46 [−3.33, −1.61] | −2.90 [−3.59, −2.20] | No |

Four of the six prespecified checks passed. The reversal history comparison and the archived original-drop check missed their thresholds. The joint target was unmet. [Protocol and runner frozen before training](https://github.com/Arhaan2/evalsim-dispatch/tree/4898a8b/training/closes)

## What the agent learned from

Each shift has eight booking decisions, two truck slots and one signed offer per decision. The history-aware and history-free policies each estimate the value of saving a truck slot. At decision time they book when the current net offer reaches that value. Both receive the clock, remaining capacity, current signed offer, and every price support and probability on the currently published board. The full model also uses the three most recent previous high/low outcomes, the earlier survey band and the count of older high offers. Only signed history differs between the two feature sets.

The training algorithm fits marginal continuation values backward from the final wave. For a next offer of value `x`, the Bellman target for the first extra slot is `max(x, D1)`. For the second extra slot it is `max(D2, min(x, D1))`, where `D1` and `D2` are the estimated marginal values at the next wave. At the last wave the continuation values are zero. A mean across matching feature groups estimates each expected target. Each group's estimate shrinks toward its parent with 32 pseudo-observations, so uncommon public histories can borrow evidence from less specific groups.

Training samples all-pass market tapes. This works because booking changes only capacity and earnings, and the next offered load is signed either way. The algorithm uses the known capacity rule to learn both action values from each tape. It learns the stochastic continuation values from observed prices. The model receives no scenario identifier, seed, ending label, hidden probabilities or future signed offer at deployment.

## Splits and uncertainty

Five independent training replicates use seeds 13, 37, 73, 101 and 211, each with its own 12,000-seed block in the training bank. Each draws 12,000 seeds with replacement and crosses each draw with all 12 training families, for 144,000 eight-wave episodes per replicate. The matched history-free fit reuses every training transition. Validation uses 128 new seeds and two new paired stems. The release protocol fixes seed 13 for both policies independent of validation scores.

| Fit seed | Validation, history RL | All fresh, history RL | Reversals, history RL | Reversals, no-history RL |
| --- | ---: | ---: | ---: | ---: |
| 13 (released) | 49.61 | 50.00 | 49.72 | 49.61 |
| 37 | 49.58 | 50.01 | 49.60 | 49.53 |
| 73 | 49.55 | 50.03 | 49.75 | 49.53 |
| 101 | 49.48 | 50.03 | 49.62 | 49.61 |
| 211 | 49.56 | 50.01 | 49.67 | 49.53 |

The public test uses four previously unseen stems, two per demand type. Everyone gets the same 512 seeds and both endings, giving 4,096 comparable shifts. A separate retention split uses 512 new seeds on each of three unchanged archived drop patterns. Guard results stay separate from the fresh average. Each two-sided 95% interval uses 2,000 paired bootstrap draws of complete scenario seeds, preserving the correlation between policies, stems and their opposite endings. The intervals describe the chosen checkpoint and synthetic patterns. Ending and individual-stem intervals are descriptive.

To pass the reversal test, the full model must have a lower confidence bound above zero against both the distribution planner and the refitted no-history model, on the same fresh reversal set. Retention requires a positive lower bound over the planner and a lower bound above −1 credit against both earlier RL agents. These conditions apply separately to fresh interrupted drops and each of the three archived drop patterns. The overall target requires them all to pass. [Frozen study design](protocol.mjs)

## Reproduce the fits

The released experiment ran on a macOS arm64 CPU with Node.js 24.18.0. From the repository root, use Node.js 22 or later. The checked run refits all ten estimators, replays every scored trajectory, regenerates the intervals and compares the complete artifact, including both released checkpoints.

```sh
node training/closes/run.mjs --check
node --test test/closes-policy.test.mjs
```

[Fitting and evaluation code](run.mjs) · [Checkpoints and case-level scores](../../docs/data/closes/results.json)
