# What the challenger learned

The public challenger learned to draw **61.1%** of its scenarios from the two demand-surge cells. It started at **20%**. The cell combining high opening demand with a later surge rose from 10% to 40.9%. This checkpoint came from training seed 101, selected before evaluation. Demand surge received 44.4% and 45.4% of final probability in the other two runs.

The challenger chooses among ten combinations of disruption and opening demand. Its reward is one when a verified witness can fulfill the shift and the training operator fails, and zero when both succeed. Its logits update after each completed operator shift. The released checkpoint contains the learned parameters, and “Challenge me” samples a fresh feasible shift from them.

## Effect on the operator

Each replicate trained two fresh operators with exactly **32,768 operator tool calls** and the same 1,600 pre-verified training scenarios. After training, each operator faced 168 previously unused test cases. Success requires every commitment to arrive on time with the ledger intact.

| Training condition | All 168 cases | Familiar families, 120 cases | Unseen combinations, 48 cases | On-time units across all cases |
| --- | ---: | ---: | ---: | ---: |
| Uniform sampling over ten cells | **77.4%** | **90.8%** | 43.8% | **97.2%** |
| Learned challenger | 75.2% | 89.4% | 39.6% | 96.8% |
| Hand-written dispatcher | 76.2% | 72.5% | **85.4%** | 97.0% |

Rates for the two learned operators average the three paired training seeds. Each seed uses the same 168 test cases. The dispatcher runs once per case. All 1,176 evaluations recorded zero accounting violations.

| Training seed | Uniform strict success | Challenger strict success | Uniform first crossing | Challenger first crossing |
| ---: | ---: | ---: | ---: | ---: |
| 101 | 78.6% | 75.6% | 32,768 calls | Unreached |
| 211 | 75.6% | 76.2% | Unreached | Unreached |
| 307 | 78.0% | 73.8% | 8,192 calls | Unreached |

The threshold was 85% complete success on 60 validation cases, checked every 4,096 calls. The two uniform crossings and zero challenger crossings provide no evidence of faster learning here. The challenger successfully identified difficult practice cases. Average final test success was 2.2 percentage points lower with the learned challenger under this budget. The experiment estimates performance for this scenario grammar, failure-gap reward and linear tool policy. It has three training seeds and 24 test cases per family.

## Accounting and reproduction

The six runs consumed 196,608 operator tool calls. The three shared banks required 44,013 witness calls to certify 4,800 training scenarios. Validation and test feasibility checks required a further 2,113 witness calls. The experiment records non-training calls and timings separately. Each matched pair had the same bank, validation suite and final suite. Validation tool counts varied with the operator's actions. Training CPU and wall time include challenger updates. Subsecond process timings are machine-specific.

Run `node training/challenger/audit.mjs` to retrain both sides of all three pairs. The audit compares the challenger probability and parameter histories, final operator weights, complete test outcomes and displayed summaries, and verifies deterministic challenge generation using 48 visitor seeds. This experiment uses fresh training, validation and test seed ranges. Its rates belong to this matched-budget comparison.

[Protocol](README.md) · [Learned challenger](../../docs/data/challenger/checkpoint.json) · [Experiment record](../../docs/data/challenger/experiment.json) · [Per-case results](../../docs/data/challenger/test-outcomes.json)
