# Working on DISPATCH

In the shared RL workspace, read [the workspace rules](../AGENTS.md), the root manifest and its lock. The workspace launcher is `"$HOME/Desktop/RL projects/bin/rl"`. Use `rl python` and `rl test` for any local Python work. The published application and its experiments use Node.js and browser modules. Their entry points are in [the project README](README.md).

Keep simulation, operator observations and verification separate. Changes to state dynamics, scoring, policy features or sampling invalidate affected evidence. Reproduce experiments before publishing updated claims. A trained policy gets only observable state. The omniscient feasibility witness is for auditing.

Keep runtime dependencies, synthetic scenarios and all publishable artifacts inside this repository. Keep downloaded model weights, native binaries, raw training state and personal configuration outside public commits. GitHub Pages serves `docs/` at a repository subpath. Use relative links for application assets.

The free labs are a way for prospective EvalSim customers to try a real operating decision, test their own policy and discuss a relevant workflow. Preserve the path from the company website to a playable lab, a reproducible local run and the company contact page. Use [the lab guide](LAB.md) and its verified examples when extending that path. Match the main site's paper, forest and lime palette. Report measured learning and failure cases separately from customer adoption.
