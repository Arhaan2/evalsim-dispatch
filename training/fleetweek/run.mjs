import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fitFleetPolicy } from "./fit.mjs";
import { createFleetWeek } from "../../docs/lib/fleetweek.js";
import { fleetReferences, replayFleetActions } from "../../docs/lib/fleetweek-benchmark.js";
import { makeFleetPolicy } from "../../docs/lib/fleetweek-policy.js";
import { FIT_SEEDS, DECISION_MS, FLEET_SUITE, FLEET_SPLITS, fleetCases, fleetLedger, summarizeFleet, pairedFleetComparison } from "../../docs/lib/fleetweek-study.js";

const check = process.argv[2] === "--check";
if (!check && process.argv[2] !== "--write") throw Error("Use --write to generate or --check to reproduce the published release.");
const dir = new URL("../../docs/data/fleetweek/", import.meta.url);
if (!check) await mkdir(dir, {recursive: true});
async function artifact(file, data) {
  const bytes = JSON.stringify(data) + "\n";
  const path = new URL(file, dir);
  if (check) assert.equal((await readFile(path,"utf8")) === bytes, true, file + " differs from the public release");
  else await writeFile(path, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

function score(config, decide) {
  const week = createFleetWeek(config);
  const actions = [];
  while (!week.done) {
    const obs = week.observe(), legal = week.legalActions(), start = performance.now();
    const id = decide(obs, legal);
    if (performance.now() - start > DECISION_MS) throw Error("Baseline exceeded the one-second decision limit.");
    week.step(id);
    actions.push(id);
  }
  const ledger = fleetLedger(week.ledger);
  assert.deepEqual(ledger, replayFleetActions(config, actions));
  return {actions, ledger};
}

const fitted = [];
for (const seed of FIT_SEEDS) {
  fitted.push({seed, weights: await fitFleetPolicy(seed)});
  console.log("Fitted train-only seed", seed);
}
const references = fleetReferences(fitted[0].weights);
const weightHashes = {};
for (const {seed, weights} of fitted) weightHashes[seed] = await artifact("model-" + seed + ".json", weights);
const results = {suite: FLEET_SUITE, primarySeed: FIT_SEEDS[0], fitSeeds: FIT_SEEDS, weightHashes, banks: {}, splits: {}};
for (const split of FLEET_SPLITS) {
  const cases = fleetCases(split).map(config => {
    const rows = Object.fromEntries(Object.entries(references).map(([name, fn]) => [name,score(config, fn)]));
    return {...config, ...rows};
  });
  results.banks[split] = await artifact(split + ".json", {suite: FLEET_SUITE, split, cases});
  const rows = cases.map(r => ({family: r.family, agent: r.rl.ledger, rl: r.rl.ledger, planner: r.planner.ledger, greedy: r.greedy.ledger}));
  const summary = summarizeFleet(rows);
  const fits = fitted.map(({seed, weights}) => {
    const decide = makeFleetPolicy(weights);
    const replicate = seed === FIT_SEEDS[0] ? rows : cases.map((r, i) => ({...rows[i], agent: score({seed:r.seed, family:r.family}, decide).ledger}));
    return {seed, net: replicate.reduce((sum,r)=>sum+r.agent.net,0)/replicate.length,
      onTime: 10 * replicate.reduce((sum,r)=>sum+r.agent.served,0)/replicate.length,
      planner: pairedFleetComparison(replicate, "planner")};
  });
  results.splits[split] = {summary, fits};
  console.log("Scored and replayed", cases.length, split, "weeks, five fits and both baselines");
}
await artifact("results.json", results);
console.log(check ? "Reproduced every checkpoint, ledger, paired result and bank digest." : "Wrote all checkpoints, paired results, scored weeks and reference replays.");
