# Benchmark an agent on profitable long-repair moves

The fleet has two competing dispatchers. One was fitted on short depot closures, and the other was fitted on a mix that included longer repairs. Each can recommend either moving or holding an empty truck. Their names refer to the length of repairs in training. The new agent estimates whether taking the long dispatcher's recommendation will earn more by Friday. The public benchmark lets your agent choose any legal joint move. [Play a decision](https://arhaan2.github.io/evalsim-dispatch/longmove.html#play) · [Study library](https://arhaan2.github.io/evalsim-dispatch/studies.html#longmove)

## Run a benchmark

Use Node.js 22 or newer. The optional Python starter also needs Python 3. The simulator and starters use their standard libraries.

```sh
git clone --branch longmove-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --suite longmove --split validation --name "My dispatcher" --policy ./examples/fleetweek-agent.mjs --out practice.json
node tools/reserve.mjs --verify practice.json
```

Replace the example with your own agent. For a fresh-week test or the double-return check, use these commands.

```sh
node tools/reserve.mjs --suite longmove --split test --policy ./examples/fleetweek-agent.mjs --out fresh.json
node tools/reserve.mjs --verify fresh.json
node tools/reserve.mjs --suite longmove --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
```

Open the report on the study page to replay its actions, check its scores, and share a link or a standalone scorecard. With a link, recipients can replay the included examples. Send the original JSON if they want to verify every week behind the aggregate. [Verify and share your scorecard](https://arhaan2.github.io/evalsim-dispatch/longmove.html#own-agent)

## Implement a dispatcher

Export a default JavaScript function `(observation, calls) => actionId` or a `createPolicy()` factory for per-week state. An external process reads one JSON line containing `observation` and `calls`, then flushes one legal joint action such as `{"action":"W|W"}`. Reset week-specific memory when epoch returns to zero. The two trucks act together on ten half-day boards. Each decision has a one-second budget. [Full agent interface](FLEETWEEK.md#agent-interface) · [JavaScript starter](examples/fleetweek-agent.mjs) · [Python starter](examples/fleetweek_agent.py)

Use public truck positions, freight, demand forecasts, closure warnings, elapsed repair time and the noisy field update. When a depot closes, freight touching it and empty inbound movements are unavailable. A truck may wait there or depart empty. All ten signed contracts count toward on-time service. Missing one costs 34 credits.

| Split | Weeks | Use |
|---|---:|---|
| `validation` | 256 | Develop on two freight patterns |
| `test` | 16,384 | Four new patterns with afternoon closures and repairs lasting one to five half-days |
| `clean` | 2,048 | Same fresh patterns without a depot closure |
| `archive` | 4,096 | Original double-return pattern with new random draws and no closure |

List the public cases with `node tools/reserve.mjs --suite longmove --split test --manifest`. Disclose which cases you used for tuning when sharing a result.

## Read the results

The registered baselines are `shortGate` (always follow the short-trained dispatcher), `flatRisk` (historical constant penalty), and `planner` (rolling planner). The other references are `rl` (the released detector and switching rule), `longGate` (always follow the long-trained dispatcher), and `flatGate` (the new rule using constant predictions). Weekly net credits deduct travel costs and missed-contract penalties. Service differences are in percentage points. The released policy must clear both earnings and service criteria against all three baselines and retain its earnings win on the archive for the joint claim. [Full results](https://arhaan2.github.io/evalsim-dispatch/longmove.html#results)

The study also measures recognition independently of deployment. On the short policy's own path, try each genuine disagreement both ways and follow short for the rest of the week. A profitable long move earns strictly more by Friday. Precision gives the share of long choices that paid off. Recall gives the share of all profitable opportunities captured. Separate outcome tables and playable forks use the new agent's own path and continuation. These comparisons answer different questions, since an early move can change where the trucks are later in the week.

## Reproduce the release

```sh
npm run audit:longmove
npm run audit:longmove:fit
npm run audit:longmove:ledgers
```

The first command refits the five checkpoints and rebuilds the scores and public page. The other two independently check training and replayed actions, ledgers and detector outcomes. [Protocol frozen before fitting](https://github.com/Arhaan2/evalsim-dispatch/blob/fd3adc75f8aa38a48bd9c72341707f9e22b8174b/training/longmove/PROTOCOL.md) · [All five checkpoints locked before testing](https://github.com/Arhaan2/evalsim-dispatch/tree/1b10573db095eb8a373a91fda12f09ff16649eaa/docs/data/longmove) · [Training details](training/longmove/) · [MIT license](LICENSE)
