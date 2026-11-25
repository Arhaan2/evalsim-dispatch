import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {FIT_SEEDS, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {hash, artifact, legacyCheckpoint, score} from "../fleetweek/score-helpers.mjs";
import {makeOverridePolicy} from "../../docs/lib/override-policy.js";
import {overrideReferences} from "../../docs/lib/override-benchmark.js";
import {OVERRIDE_SUITE, OVERRIDE_SPLITS, OVERRIDE_REFERENCES, overrideCases, summarizeOverride} from "../../docs/lib/override-study.js";
import {overrideBranches, summarizeOverrides} from "./diagnostics.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode)) throw Error("Choose --write to score or --check to reproduce.");
const dir = new URL("../../docs/data/override/", import.meta.url);
const [previous, overnight] = await Promise.all([legacyCheckpoint(dir, "fleetweek"), legacyCheckpoint(dir, "overnight")]);
const fits = await Promise.all(FIT_SEEDS.map(async seed => {
  const bytes = await readFile(new URL("model-" + seed + ".json", dir));
  const checkpoint = JSON.parse(bytes);
  assert.equal(checkpoint.seed, seed, "Frozen checkpoint seed");
  return {seed, checkpoint, digest: hash(bytes)};
}));
const primary = fits[0].checkpoint;
const refs = overrideReferences({current: primary, previous: previous.checkpoint, overnight: overnight.checkpoint});
assert.deepEqual(Object.keys(refs), OVERRIDE_REFERENCES);
const results = {suite: OVERRIDE_SUITE, primarySeed: FIT_SEEDS[0], fitSeeds: FIT_SEEDS,
  weightHashes: Object.fromEntries(fits.map(fit => [fit.seed, fit.digest])),
  previousHash: previous.hash, overnightHash: overnight.hash, banks: {}, splits: {}};

for (const split of OVERRIDE_SPLITS) {
  const cases = overrideCases(split).map(config => {
    const records = Object.fromEntries(Object.entries(refs).map(([name, policy]) => [name, score(config, policy)]));
    return {...config, ...records, branches: overrideBranches(config, records.rl, primary)};
  });
  results.banks[split] = await artifact(dir, mode, split + ".json", {suite: OVERRIDE_SUITE, split, cases});
  const rows = cases.map(row => ({family: row.family, agent: row.rl.ledger,
    ...Object.fromEntries(OVERRIDE_REFERENCES.map(name => [name, row[name].ledger]))}));
  const summary = summarizeOverride(rows);
  const replicates = fits.map(({seed, checkpoint}) => {
    const decide = makeOverridePolicy(checkpoint);
    const weeks = seed === FIT_SEEDS[0] ? rows : cases.map((config, i) => ({...rows[i], agent: score(config, decide).ledger}));
    return {seed, net: weeks.reduce((s, w) => s + w.agent.net, 0) / weeks.length,
      onTime: 10 * weeks.reduce((s, w) => s + w.agent.served, 0) / weeks.length,
      planner: pairedFleetComparison(weeks, "planner")};
  });
  const versusPlanner = Object.fromEntries(OVERRIDE_REFERENCES.map(name => [name, name === "rl" ? summary.all.comparisons.planner :
    pairedFleetComparison(rows.map(row => ({family: row.family, agent: row[name], planner: row.planner})), "planner")]));
  results.splits[split] = {summary, fits: replicates, versusPlanner, diagnostics: summarizeOverrides(cases, primary)};
  console.log("Scored", split, cases.length, "weeks, six reference dispatchers, five fits and paired override decisions.");
}
const fresh = results.splits.test.summary.all;
const doubleReturn = results.splits.archive.summary.all.earnsMoreThanPlanner;
results.goals = {freshProfit: fresh.earnsMoreThanPlanner, freshService: fresh.matchesPlannerService, doubleReturn,
  joint: fresh.beatsPlanner && doubleReturn};
await artifact(dir, mode, "results.json", results);
console.log(mode === "--check" ? "Reproduced all scored artifacts." : "Recorded all override benchmark results.");
