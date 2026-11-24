# Benchmark your agent on Freight Reserve

Your dispatcher gets two truck slots and eight signed offers, one per wave. Accept a load to earn its quoted revenue less its lane cost, or pass to keep the slot. An unaccepted offer expires when its wave ends. Policies face the same eight realized offers and public forecasts on a given shift. Their remaining capacity depends on which loads they book. [Play Freight Reserve](https://arhaan2.github.io/evalsim-dispatch/reserve.html)

## Run the public benchmark

Use Node.js 22 or later. The runner has zero npm dependencies. The following commands pin the environment, checkpoints and case order to the first Reserve release.

```sh
git clone --branch reserve-v1.0.0 https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/reserve.mjs --policy ./examples/reserve-agent.mjs --out my-result.json
node tools/reserve.mjs --verify my-result.json
```

The default is the **exact 768-shift public test**. The scorecard shows mean net credits for each demand pattern and the difference against each reference, with wins, ties and losses. Save the JSON file to replay it locally or open it under **Benchmark your agent** in the browser lab. The file contains all chosen actions and credits. Verification reruns the complete manifest and the three baselines. It establishes what those decisions earned. Identifying the external implementation that made them is up to the submitter.

## Bring a JavaScript agent

Copy [the example](examples/reserve-agent.mjs). Export a decision function, or export a synchronous `createPolicy()` factory returning one decision function per shift. Each decision can be asynchronous. Return an ID from the available calls. For example, this rule uses the public mean of the next offer as its booking threshold.

```js
export default function decide(observation, calls) {
  if (!calls.some(call => call.id === "accept")) return "pass";
  const nextMean = observation.forecast[0]?.mean ?? 0;
  return observation.offer.net >= nextMean ? "accept" : "pass";
}
```

Develop on the **192 validation shifts**. Use a fixed agent, including its random seed if it samples, for the public comparison.

```sh
node tools/reserve.mjs --split validation --policy ./examples/reserve-agent.mjs
node tools/reserve.mjs --name my-dispatcher --policy ./examples/reserve-agent.mjs --out my-result.json
```

## Bring a Python agent or another executable

The runner launches your program locally and sends one JSON object per line of stdin. Return one JSON object on stdout for each request, for example `{"action":"accept"}`. The program persists across the suite. Reset shift-specific memory when `observation.wave === 0`. Flush each reply and write diagnostics to stderr. The per-decision timeout defaults to 60 seconds and accepts an override in milliseconds. The included [Python starter](examples/reserve_agent.py) uses only the standard library and implements the same policy as the JavaScript starter.

```sh
node tools/reserve.mjs --name my-python-agent --out python-result.json -- python3 examples/reserve_agent.py
```

Both interfaces run your code with your local process permissions. The browser accepts a completed JSON report and verifies it on your device. It does not need your agent code, model weights or API credentials.

## What the agent sees

| Field | Meaning |
| --- | --- |
| `observation.wave`, `horizon` | Current zero-based wave and number of offers in the shift. |
| `observation.slots`, `capacity` | Remaining and initial truck slots. A booking uses one. |
| `observation.offer` | Current lane, signed revenue, cost and net credits. |
| `observation.forecast` | Future waves in order, each with the possible low and high net credits, the probability of the high offer (`highChance`) and the exact mean. Conditional draws are independent across waves. |
| `observation.net`, `done` | Credits booked so far and termination state. The runner requests decisions only on active waves. |
| `calls` | Objects with an action `id` and a readable `label`. Accept while a slot remains. Pass is always legal on an active wave. |

There is no seed, family label or future realized offer in the agent request. The lab is open source and runs on the participant's machine. For a comparable score, use only the supplied observations and calls, reset memory between shifts and keep the public test cases out of training. A fresh private holdout is appropriate once you have tuned against these public scores.

## Read and reproduce the comparison

The suite ID is `dispatch-reserve-v1`. It crosses 256 seeds (7100000–7100255 inclusive) with steady, surge and volatile demand in that order. The validation split uses 6100000–6100063. A scenario seed is shared across the three families. Intervals resample whole seeds, keeping the three families and all operators paired. A score is synthetic freight contribution in credits per shift. Higher is better.

| Same 768 shifts | What the reference does |
| --- | --- |
| `planner` | Replans each wave using the current signed load and the exact mean of each future offer. |
| `stochastic` | Uses dynamic programming over the full public forecast probabilities and available slots. It maximizes expected credits under this simulator’s demand law. |
| `rl` | Uses a released table of action values fitted from sampled dispatch transitions and rewards during training. |

```sh
node tools/reserve.mjs --manifest > reserve-test-manifest.json
node tools/reserve.mjs --policy rl --out reference.json
npm run audit:reserve
```

The manifest command lists every shift without running a policy. The audit refits all five independently trained policies and verifies the released measurements. To inspect a particular case from any report, open the lab with its family and seed, such as [surge shift 7100000](https://arhaan2.github.io/evalsim-dispatch/reserve.html?family=surge&seed=7100000). The published holdout measures new draws from these six schedule templates. Generalization to different demand processes or real freight operations requires separate evidence. [Training report and protocol](training/reserve/) · [Per-shift results and released checkpoint](docs/data/reserve/results.json)

The [MIT license](LICENSE) covers the original simulator, runner and examples, including commercial reuse subject to its notice. [Share a score or request a workflow benchmark](https://github.com/Arhaan2/evalsim-dispatch/issues/new?template=lab-feedback.yml) · [Contact EvalSim](https://arhaan2.github.io/evalsim-site/#contact)
