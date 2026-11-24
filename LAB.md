# Run your agent in the Cutoff lab

[Play a shift in your browser](https://arhaan2.github.io/evalsim-dispatch/cutoff.html) · [Compare the harbor policies](https://arhaan2.github.io/evalsim-dispatch/?scenario=compound&seed=3000000&operator=uniform&compare=planner) · [Share a result or suggest a commercial workflow](https://github.com/Arhaan2/evalsim-dispatch/issues/new?template=lab-feedback.yml)

Cutoff is a free, synthetic dispatch lab for testing whether an agent pays for information when it changes a time-sensitive decision. A central express truck can serve either customer. Only one satellite yard can fill its local order. Every accepted shipment consumes stock, carrier capacity and budget, and success requires both deliveries to arrive by deadline.

In the **uncertain** family both yard reports are estimates. In the **urgent** family signed counts are already available and the express truck leaves this tick. Each seed has two inventory variants. The two uncertain variants have identical opening observations and require opposite express bookings. A visitor can play, change the hidden inventory, compare policies, share the opening setup, and download a trace without creating an account. The published policies and data are for this simulated operating decision.

## First run

Use Node.js 22 or later. There are no npm runtime dependencies and the CPU lab runs offline after checkout.

```sh
git clone https://github.com/Arhaan2/evalsim-dispatch.git
cd evalsim-dispatch
node tools/lab.mjs --policy planner --seed 42 --pairs 16
node tools/lab.mjs --policy ./examples/earliest-deadline.mjs --seed 42 --pairs 16
```

The first command runs 64 shifts: 16 seeds × two timing families × two inventory variants. Compare **successes** and **bothTwinsSolved** across agents with identical arguments. The second count gives credit only when a policy succeeds with both possible inventories. The summary also includes service volume, spend and tool calls. Try `--policy uniform` or `--policy progress` for the published CPU checkpoints, or `--policy no-check` for the planner with inspection disabled.

## Plug in a policy

Copy [the example module](examples/earliest-deadline.mjs) and replace its decision function. It receives a fresh public observation and an array of available calls, each with an ID and a display label. Return an ID from that array. Async decision functions also work. The evaluator runs local modules with your Node process's permissions.

```js
export default function decide(observation, calls) {
  const check = calls.find(call => call.id === "inspect");
  if (check && observation.yards.some(yard => !yard.confirmed)
      && observation.tick < observation.express.cutoff) return check.id;
  const booking = calls.find(call => call.id.startsWith("express-") || call.id.startsWith("local-"));
  return booking?.id ?? "wait";
}
```

This starter demonstrates the interface. It chooses the first available booking. For a meaningful comparison change how it uses stock reports and deadlines. For a stateful agent, export a synchronous `createPolicy()` function returning a new decision function. The runner calls the factory once per shift so its memory starts empty. Keep all episode-specific state inside that function. The runner sends no seeds, hidden stock, variant labels, verifier scores or future state to the decision function. An external model belongs behind your own decision function. The hosted lab requires no model API key.

Generate a single trace and replay it. You can pass a trace downloaded from the browser to the same verifier.

```sh
node tools/lab.mjs --policy uniform --seed 42 --family uncertain --variant 0 > shift.json
node tools/lab.mjs --replay shift.json
```

## Use the simulator as a library

From inside the checkout or a vendored copy, use the browser-compatible ES module. Node projects that install this repository as a Git dependency can import the same functions from `evalsim-dispatch`.

```js
import { runCase, replayCase, planner } from "./docs/lib/lab.js";

const trace = await runCase({ seed: 42, split: "test", variant: 0, family: "uncertain" }, planner);
const { complete, score } = replayCase(trace);
console.log(complete, score.success, score.onTimeUnits, score.spend);
```

A run returns a JSON record with the version, configuration, ordered action IDs, completion flag and ledger score. The score counts verified arrivals, on-time units, calls, spend and resource violations. Replaying a completed record checks the reported score and declared completion against the simulator. Browser exports can also represent an unfinished shift. Replaying one shows its current ledger. Reports are reproducible synthetic records rather than signed attestations of which external model produced them.

The public test ranges can be inspected in the [CPU protocol](training/cutoff/protocol.mjs). Each split uses two customers and two carriers. Held-out shifts vary place names, quantities and timing. Create a separate evaluation set before tuning your own policies. The [Qwen experiment](training/cutoff/qwen/) documents its separate inference, training and evaluation costs.

## Link a lab from your site

The public page opens directly at a GitHub Pages subpath. A normal link preserves mobile navigation, keyboard controls and trace downloads.

```html
<a href="https://arhaan2.github.io/evalsim-dispatch/cutoff.html">
  Try EvalSim's free dispatch lab
</a>
```

To invite someone to your shift, use the lab's share control. It preserves your configuration and the actions you have taken. For self-hosting, serve the `docs/` directory with a static HTTP server. The site uses relative asset URLs. Use `npm start` for a local preview.

## Commercial use and feedback

The [MIT license](LICENSE) covers EvalSim's original lab code and accompanying documentation. Retain its notice when redistributing it. The [Geist font](docs/assets/geist-license.txt) and [Qwen base model](training/language-model/QWEN-LICENSE.txt) have their own licenses. EvalSim branding identifies the official lab. The original code's license does not grant trademark rights. The CPU lab can run on your infrastructure without downloading Qwen.

[Discuss your team's workflow with EvalSim](https://arhaan2.github.io/evalsim-site/#contact) or [share a reproducible lab result](https://github.com/Arhaan2/evalsim-dispatch/issues/new?template=lab-feedback.yml). The GitHub form is public. Describe the decision and success condition with synthetic examples.
