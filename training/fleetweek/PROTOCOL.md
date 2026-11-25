# Five-day fleet study protocol

## Primary question

Does a dispatcher trained with reinforcement learning earn more net credits than the rolling planner on previously unseen market schedules while preserving contract service? A fleet of two trucks operates from three depots over ten dispatch rounds. Each week is a single episode. Truck locations carry through the night. Policies see the same public dispatch observation and legal moves, face the same posted costs, and receive no seed, market name or unrevealed offer.

## Frozen comparisons

Fit seeds 13, 37, 73, 101 and 211. Publish fit 13 regardless of its outcome. Report all other fits separately; their scores show training variability and do not increase the number of independent test weeks. Training uses only the training market families and seeds below 81,000,000. Freeze generator, planner, learner, fit configuration and scoring rule on GitHub before fitting. Fit all five before inspecting either evaluation split.

Compare the release policy, stochastic lookahead planner and immediate-net greedy dispatcher on identical freight arrivals. The budget is one second per decision, single CPU process, no network required. The planner and trained policy may use offline knowledge of the public rules. The planner filters demand-center probabilities from the public bulletin and history with 0.65 persistence. Its dynamic program integrates 18 possible boards per future round. The learner fits 59 observable features to position values through backward Bellman updates, using 768 full weeks in each of seven training families per fit. Each fit uses a separate seed block. Its joint-action ties follow the same service and empty-mile rules as the planner.

Development evaluation uses 128 weeks per validation family starting at 82,000,000. The fresh test uses 512 weeks per held-out family starting at 86,000,000. Add 10,000 for each successive family in that split. Each family has its own independent seeds. All ten decisions from a week stay together when scoring. Net credits subtract loaded mileage costs, empty travel costs and missed-contract penalties from freight revenue. Ten contracts are due per week. Report net, on-time share, empty mileage and the share of weeks with at least seven contracts served.

The primary success rule uses the pooled fresh test. The lower endpoint of the 95% paired interval on weekly net credits must exceed zero. Both policies must serve at least 70% of contracts in aggregate, and the lower endpoint on the trained policy’s service difference must be at least −1 percentage point. Resample 2,000 times with replacement within each family, preserving paired weeks and family weights; use bootstrap seed 9713. Publish schedule-specific results, all fit seeds and the greedy comparison as secondary analyses. The study concerns these synthetic schedules and the published decision budget.
