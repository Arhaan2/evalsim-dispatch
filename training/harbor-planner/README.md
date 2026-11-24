# Harbor v1 planning baseline

The [frozen harbor release](https://github.com/Arhaan2/evalsim-dispatch/tree/harbor-v1.0.0) preserves the original training experiment. The additional baseline was designed after examining the generator. It uses the public observation, the common action menu and memory of its own inspections and public disruption bulletins.

The planner waits for the early disruptions and prepaid inbound delivery, inspects both warehouses, then searches the at most sixteen ways to allocate four full orders. It selects the cheapest available plan that meets stock, budget and departure deadlines. Failing that, it falls back to the original dispatcher. The planner and operator both receive the same simulator interface. This planner encodes specific knowledge of the two-yard layout and disruption timing.

Run `node training/harbor-planner/audit.mjs` to check the [recorded measurements](../../docs/data/harbor-planner.json). The planner completed 168/168 original cases and 700/700 additional cases, with zero rejected calls. The original dispatcher completed 504/700 additional cases. The additional suite crosses seeds 87,000,000–87,000,099 with all seven families from the same generator. Those cases test repeatability within the generator. They do not measure real-world operations.
