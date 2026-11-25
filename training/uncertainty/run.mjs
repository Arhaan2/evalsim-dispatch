import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {FIT_SEEDS, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {hash, artifact, legacyCheckpoint, score} from "../fleetweek/score-helpers.mjs";
import {makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {uncertaintyReferences} from "../../docs/lib/uncertainty-benchmark.js";
import {UNCERTAINTY_SUITE, UNCERTAINTY_SPLITS, UNCERTAINTY_REFERENCES, uncertaintyCases, summarizeUncertainty} from "../../docs/lib/uncertainty-study.js";
import {uncertaintyBranches, summarizeUncertaintyDecisions} from "./diagnostics.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode)) throw Error("Choose --write to score or --check to reproduce.");
const dir = new URL("../../docs/data/uncertainty/", import.meta.url);
const [previous, overnight, override] = await Promise.all(["fleetweek", "overnight", "override"].map(name => legacyCheckpoint(dir, name)));
const fits = await Promise.all(FIT_SEEDS.map(async seed => {
  const bytes = await readFile(new URL("model-" + seed + ".json", dir));
  const checkpoint = JSON.parse(bytes);
  assert.equal(checkpoint.seed, seed, "Frozen checkpoint seed");
  return {seed, checkpoint, digest: hash(bytes)};
}));
const primary = fits[0].checkpoint;
const refs = uncertaintyReferences({current: primary, override: override.checkpoint, previous: previous.checkpoint, overnight: overnight.checkpoint});
assert.deepEqual(Object.keys(refs), UNCERTAINTY_REFERENCES);
const results = {suite: UNCERTAINTY_SUITE, primarySeed: FIT_SEEDS[0], fitSeeds: FIT_SEEDS,
  weightHashes: Object.fromEntries(fits.map(fit => [fit.seed, fit.digest])),
  previousHash: previous.hash, overnightHash: overnight.hash, overrideHash: override.hash, banks: {}, splits: {}};

for (const split of UNCERTAINTY_SPLITS) {
  const cases = uncertaintyCases(split).map(config => {
    const records = Object.fromEntries(Object.entries(refs).map(([name, policy]) => [name, score(config, policy)]));
    return {...config, ...records, branches: uncertaintyBranches(config, records.rl, primary, override.checkpoint)};
  });
  results.banks[split] = await artifact(dir, mode, split + ".json", {suite: UNCERTAINTY_SUITE, split, cases});
  const rows = cases.map(row => ({family: row.family, agent: row.rl.ledger,
    ...Object.fromEntries(UNCERTAINTY_REFERENCES.map(name => [name, row[name].ledger]))}));
  const summary = summarizeUncertainty(rows);
  const replicates = fits.map(({seed, checkpoint}) => {
    const decide = makeUncertaintyPolicy(checkpoint, override.checkpoint);
    const weeks = seed === FIT_SEEDS[0] ? rows : cases.map((config, i) => ({...rows[i], agent: score(config, decide).ledger}));
    return {seed, net: weeks.reduce((s, w) => s + w.agent.net, 0) / weeks.length,
      onTime: 10 * weeks.reduce((s, w) => s + w.agent.served, 0) / weeks.length,
      planner: pairedFleetComparison(weeks, "planner")};
  });
  const versusPlanner = Object.fromEntries(UNCERTAINTY_REFERENCES.map(name => [name, name === "rl" ? summary.all.comparisons.planner :
    pairedFleetComparison(rows.map(row => ({family: row.family, agent: row[name], planner: row.planner})), "planner")]));
  results.splits[split] = {summary, fits: replicates, versusPlanner, diagnostics: summarizeUncertaintyDecisions(cases, primary)};
  console.log("Scored", split, cases.length, "weeks, seven reference dispatchers, five fits and paired uncertainty decisions.");
}
const fresh = results.splits.test.summary.all;
const doubleReturn = results.splits.archive.summary.all.earnsMoreThanPlanner;
results.goals = {freshProfit: fresh.earnsMoreThanPlanner, freshService: fresh.matchesPlannerService, doubleReturn,
  joint: fresh.beatsPlanner && doubleReturn};
await artifact(dir, mode, "results.json", results);
console.log(mode === "--check" ? "Reproduced all scored artifacts." : "Recorded all uncertainty benchmark results.");
