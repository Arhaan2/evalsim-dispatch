import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { CUTOFF_VERSION, FAMILIES, noCheck, planner, replayCase, runCase } from "../docs/lib/lab.js";
import { chooseCutoff } from "../docs/lib/cutoff-policy.js";

const usage = `Run an agent on paired Cutoff shifts (Node.js 22+)
  node tools/lab.mjs --policy planner --seed 42 --pairs 16
  node tools/lab.mjs --policy ./examples/earliest-deadline.mjs --pairs 4
  node tools/lab.mjs --policy uniform --seed 42 --family uncertain --variant 0
  node tools/lab.mjs --replay path/to/trace.json

Policies: planner, no-check, uniform, progress, or a local ES module with a default policy function.
The suite uses consecutive seeds, both inventory variants, and both timing families by default.
Pass --variant 0 or 1 for a single trace. --split accepts train, validation or test (default).`;
async function main() {
  const {values} = parseArgs({options: {
    policy: {type:"string"}, seed: {type:"string"}, pairs: {type:"string"}, family: {type:"string"},
    variant: {type:"string"}, split: {type:"string"}, replay: {type:"string"}, help: {type:"boolean"},
  }});
  if (values.help) return console.log(usage);
  if (values.replay) {
    if (Object.keys(values).length !== 1) throw new Error("Use --replay on its own.");
    const record = JSON.parse(await readFile(values.replay, "utf8"));
    const { complete, score } = replayCase(record);
    return console.log(JSON.stringify({ complete, score }, null, 2));
  }
  function integer(name, fallback, max) {
    const value = values[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
      throw new RangeError("Invalid --" + name);
    return Number(value);
  }
  const seed = integer("seed", 42, 0xffffffff), pairs = integer("pairs", 16, 0x100000000);
  const split = values.split ?? "test", family = values.family ?? "uncertain";
  const single = values.variant !== undefined;
  if (!FAMILIES.includes(family) || !["train", "validation", "test"].includes(split)) throw new Error("Unknown family or split.");
  if (!pairs || (!single && seed + pairs - 1 > 0xffffffff)) throw new RangeError("Pairs must fit within the seed range.");
  if (single && values.pairs !== undefined) throw new Error("Choose a single --variant or a benchmark with --pairs.");
  const policy = values.policy ?? "planner";
  let makePolicy;
  if (policy === "planner" || policy === "no-check") makePolicy = () => policy === "planner" ? planner : noCheck;
  else if (policy === "uniform" || policy === "progress") {
    const report = JSON.parse(await readFile(new URL("../docs/data/cutoff/results.json", import.meta.url)));
    makePolicy = () => obs => chooseCutoff(obs, report.checkpoints[policy].weights);
  } else {
    const module = await import(pathToFileURL(resolve(policy)).href);
    if (typeof module.createPolicy === "function") makePolicy = module.createPolicy;
    else if (typeof module.default === "function") makePolicy = () => module.default;
    else throw new TypeError("Export a default policy function or a createPolicy factory from your local module.");
  }
  if (single) {
    const trace = await runCase({ seed, split, family, variant:integer("variant", 0, 1) }, makePolicy());
    return console.log(JSON.stringify({ ...trace, operator: policy }, null, 2));
  }
  const families = values.family ? [family] : FAMILIES;
  const summary = { version:CUTOFF_VERSION, policy, seed, pairsPerFamily:pairs, split, families,
    shifts:0, successes:0, bothTwinsSolved:0, pairs:0, onTimeUnits:0, totalUnits:0, calls:0, spend:0 };
  for (let i = 0; i < pairs; i++) {
    for (const family of families) {
      let both = true;
      for (const variant of [0, 1]) {
        const {score} = await runCase({ seed: seed+i, split, family, variant }, makePolicy());
        if (score.violations.length) throw new Error("Ledger failed to reconcile.");
        summary.shifts++;
        summary.successes += Number(score.success);
        both &&= score.success;
        for (const key of ["onTimeUnits", "totalUnits", "calls", "spend"]) summary[key] += score[key];
      }
      summary.pairs++;
      summary.bothTwinsSolved += Number(both);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
