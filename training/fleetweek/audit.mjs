// Check the published trajectories and statistics separately from the experiment's scorer.
// The environment supplies only the exogenous public boards. This checker accounts for both
// named trucks, their locations, costs, expired contracts and gross revenue itself.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FLEET_FAMILIES } from "../../docs/lib/fleetweek.js";
import { chooseFleetPlanner, chooseFleetGreedy } from "../../docs/lib/fleetweek-planner.js";
import { makeFleetPolicy } from "../../docs/lib/fleetweek-policy.js";

import { publicFrames, replay, paired, average } from "./audit-helpers.mjs";

const data = new URL("../../docs/data/fleetweek/", import.meta.url);
const fits = [13, 37, 73, 101, 211];

async function artifact(name, hash) {
  const bytes = await readFile(new URL(name, data));
  if (hash) assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, name);
  return JSON.parse(bytes);
}

function checkSection(rows, summary) {
  assert.equal(summary.weeks, rows.length);
  for (const policy of ["rl", "planner", "greedy", "agent"]) {
    assert.deepEqual(average(rows, policy), summary.policies[policy]);
    if (policy !== "agent") assert.deepEqual(paired(rows, policy), summary.comparisons[policy]);
  }
  const cmp = summary.comparisons.planner;
  assert.equal(summary.beatsPlanner, cmp.net95[0] > 0 && cmp.service95[0] >= -1 &&
    summary.policies.agent.onTime >= 70 && summary.policies.planner.onTime >= 70);
}

const result = await artifact("results.json");
assert.equal(result.suite, "dispatch-fleetweek-v1");
assert.deepEqual(result.fitSeeds, fits); assert.equal(result.primarySeed, 13);
const policies = [];
for (const seed of fits) {
  assert.match(result.weightHashes[seed], /^[0-9a-f]{64}$/);
  policies.push(makeFleetPolicy(await artifact("model-" + seed + ".json", result.weightHashes[seed])));
}
for (const [split, count, start] of [["validation", 128, 82000000], ["test", 512, 86000000]]) {
  assert.match(result.banks[split], /^[0-9a-f]{64}$/);
  const bank = await artifact(split + ".json", result.banks[split]);
  assert.equal(bank.split, split); assert.equal(bank.suite, result.suite);
  const families = FLEET_FAMILIES[split];
  assert.equal(bank.cases.length, families.length * count);
  const runs = [];
  for (const [i, row] of bank.cases.entries()) {
    const f = Math.floor(i / count);
    assert.equal(row.family, families[f]);
    assert.equal(row.seed, start + 10000 * f + i % count);
    const frames = publicFrames(row);
    const fitLedgers = policies.map((policy, j) => replay(frames, policy, j === 0 ? row.rl : undefined));
    runs.push({ family: row.family, rl: fitLedgers[0], agent: fitLedgers[0], fits: fitLedgers,
      planner: replay(frames, chooseFleetPlanner, row.planner),
      greedy: replay(frames, chooseFleetGreedy, row.greedy) });
  }
  const s = result.splits[split];
  checkSection(runs, s.summary.all);
  for (const family of families) checkSection(runs.filter(row => row.family === family), s.summary.byFamily[family]);
  assert.deepEqual(s.fits.map(record => record.seed), fits);
  for (const [i, record] of s.fits.entries()) {
    const replicate = runs.map(r => ({ ...r, agent: r.fits[i] }));
    assert.equal(average(replicate, "agent").net, record.net);
    assert.equal(average(replicate, "agent").onTime, record.onTime);
    assert.deepEqual(paired(replicate, "planner"), record.planner);
  }
  console.log(split + ": " + runs.length + " common weeks, " + runs.length * 7 * 10 +
    " independently accounted truck-pair decisions, five fits and all reported weekly comparisons verified.");
}

// The two published worked examples switch just the first diverging action, then give
// control back to the same trained policy. This isolates positioning on that particular tape.
for (const [seed, epoch, chosen, alternative, net, switchedNet] of [
  [86000042, 1, "E2|C", "E0|C", 379, 345],
  [86000079, 5, "C|W", "C|E1", 420, 464],
]) {
  const frames = publicFrames({ seed, family: "friday-switch" });
  let observed = false;
  const switched = (obs, actions) => {
    const learned = policies[0](obs, actions);
    if (obs.epoch !== epoch) return learned;
    assert.equal(learned, chosen);
    assert.equal(chooseFleetPlanner(obs, actions), alternative);
    observed = true;
    return alternative;
  };
  assert.equal(replay(frames, policies[0]).net, net);
  assert.equal(replay(frames, switched).net, switchedNet);
  assert(observed);
}
console.log("Verified both worked overnight examples by changing only the disputed action and re-running RL to Friday.");
