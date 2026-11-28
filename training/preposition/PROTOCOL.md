# Can positioning the trucks before a closure save deliveries?

In DISPATCH two trucks work ten half-days across three depots. A signed contract expires each round. A public warning gives the depot and start time one half-day before it closes. The freight in later rounds, the exact repair duration and future crew updates are hidden from every operating policy. This study asks whether a dispatcher can improve a single warning-time decision and whether its improved service pays for repositioning. The frozen parent is [switch-cost fit 73](https://github.com/Arhaan2/evalsim-dispatch/tree/switchcost-v1.0.0), which the preceding release retained.

## Decisions and training

Outside the warning, take fit 73's action from the trucks' **current** positions. At the warning, consider **every legal joint dispatch**, including assigning current loads, waiting and moving an empty truck. A week starts with one truck at each of Harbor and Inland. All trucks, costs, contracts and notices use the existing fleet simulator. There is no advance information about the closure until the warning.

Train three independent policies on eleven established training demand schedules, seeds 73 (designated primary), 101 and 211. Each fit receives 2,048 fitting weeks and 1,024 independent selection weeks per family. Fit index starts at zero in the order given. Start fitting seeds at 1,200,000,000 + 5,000,000 times that index. The selection offset is 1,000,000. Add family index times the per-family count, followed by within-family week index. On each training and selection week, sample closure starts uniformly from [2,3,4,5,6,7,8] and durations from [1,2,3,4,4,5,5]. Exactly one warning occurs per closure week.

Follow fit 73 up to the warning. On the same realized freight and repair draws, compare all legal alternatives at that board. After the first action, follow the frozen parent on each branch from its own ordered truck positions through Friday. Reuse suffixes when actions end at the same ordered positions. For regression, represent the six physical arrangements equally and average over the one or two distinct truck orderings of each. Center the six feature vectors and targets within the same board. The first head learns the residual in suffix net credits relative to the rolling planner's public continuation estimate. The second learns remaining signed contracts served. Both heads use ridge strength 0.02. At deployment they receive only public information. Add each legal action's immediate net and service to its predicted continuation. Price a contract at [0,4,12,24,48] extra credits in the decision objective and test improvement hurdles [0,2,6]. The simulator's financial ledger always uses its original costs.

Evaluate all fifteen settings against the parent on separate selection weeks, with actual ordered truck positions. A setting may override only on a strict score gain above its hurdle. Ties favor the parent and then legal menu order. Prefer settings whose selection net and service both exceed the parent's; among those choose the greatest net gain, then service, then grid order. Otherwise choose the active candidate maximizing the smaller of its net gain and 34 times its extra signed contracts, then service and grid order. This precommits the release to an evaluated learned rule even if selection improvements are inconclusive. Publish the selection table and every fit. Freeze source and protocol before fitting, and publish checkpoints before evaluating any held-out bank.

## Fresh weeks and controls

Hold all test seeds and ten public development/test demand schedules out of training and selection. Check that the new depot sequences are unique under depot relabeling relative to earlier studies. A seed block begins at the bank's base plus 10,000 times the family's index. Each family uses consecutive seeds within its block.

| Bank | Schedules and relative depot sequence | Weeks per schedule | First seed | Closure starts, duration draws |
|---|---|---:|---:|---|
| Validation | position-crossing 0012021001, position-bend 0110201221 | 128 | 1,250,000,000 | [2,4,6], [1,2,3,4,5] |
| Fresh | position-relay 0012121100, position-return 0012202010, position-east 0121012200, position-weave 0112001201, position-late 0010221201, position-ramp 0001211220, position-pivot 0100102212, position-transfer 0011222102 | 4,096 | 1,260,000,000 | [3,5,7], [1,2,3,4,4,4,5,5,5] |
| Clean | Same eight fresh schedules, all depots open | 512 | 1,270,000,000 | None |
| Double-return | Original double-return pattern 0011002200, all depots open | 4,096 | 1,280,000,000 | None |

Time starts at zero on Monday morning. Late closures can extend through the end of the week; report the number of closed half-days observed by Friday when grouping duration. Evaluate the primary, the two independent fits, frozen fit 73, the rolling closure planner, the constant penalty and the always-short dispatcher on complete weeks. Test whether the no-warning banks reproduce fit 73 action for action.

## Four primary tests

On 32,768 fresh weeks, require a strictly positive lower two-sided paired 95% confidence bound for each of these comparisons.

1. Extra signed deliveries per week over frozen fit 73.
2. Extra signed deliveries per week over the rolling planner.
3. Extra net credits per week over frozen fit 73.
4. Extra net credits per week over the rolling planner.

All weeks count, including weeks in which the agent follows the parent's warning choice. All ten signed contracts count for service, including contracts made impossible by a closed depot. Service percentages divide signed deliveries by ten; a one-percentage-point increase equals 0.1 extra deliveries per week. Count net credits after loaded and empty travel and the 34-credit penalty on every missed signed contract. Resample whole paired weeks within freight family using the established 2,000-draw bootstrap, seed 9713. Require all four primary criteria for the joint claim. Publish the means, bounds, family/subgroup results, secondary fits and both wins and losses. The intervals describe new draws on these benchmark schedules.

Also pair policies by the same exact signed delivery on the same half-day. Report newly served and newly missed contracts, for the whole week and Friday alone. Compare warning actions and their weekly consequences. From the fresh bank choose the first case where the released agent saves a Friday contract compared with the parent and the first where it sacrifices one, when available. Check Friday morning before afternoon within a week. Also identify the first legal warning alternative in manifest and legal menu order that changes a Friday contract outcome on the frozen continuation. Clearly label an illustrative alternative separately from a released agent's move. The challenge reveals which choice served the specific Friday delivery, the weekly performance of both branches and what each truck did. These selected episodes illustrate mechanisms; the four tests use every fresh week.

Publish the research and the playable study regardless of outcome. Visitors' own agents can act at all ten decisions and benchmark on the same four banks.
