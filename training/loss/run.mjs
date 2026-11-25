import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {FIT_SEEDS, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {hash, artifact, legacyCheckpoint, score} from "../fleetweek/score-helpers.mjs";
import {makeLossPolicy} from "../../docs/lib/loss-policy.js";
import {lossReferences} from "../../docs/lib/loss-benchmark.js";
import {LOSS_SUITE, LOSS_SPLITS, LOSS_REFERENCES, lossCases, summarizeLoss} from "../../docs/lib/loss-study.js";
import {lossBranches, summarizeLossDecisions} from "./diagnostics.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode)) throw Error("Choose --write to score or --check to reproduce.");
const dir = new URL("../../docs/data/loss/", import.meta.url);
const [previous, override, uncertainty] = await Promise.all(["fleetweek", "override", "uncertainty"].map(name => legacyCheckpoint(dir, name)));
const fits = await Promise.all(FIT_SEEDS.map(async seed => {
  const bytes = await readFile(new URL("model-" + seed + ".json", dir));
  const checkpoint = JSON.parse(bytes);
  assert.equal(checkpoint.seed, seed);
  return {seed, checkpoint, digest: hash(bytes)};
}));
const weights = {current: fits[0].checkpoint, previous: previous.checkpoint, override: override.checkpoint,
  uncertainty: uncertainty.checkpoint};
const refs = lossReferences(weights);
assert.deepEqual(Object.keys(refs), LOSS_REFERENCES);
const results = {suite: LOSS_SUITE, primarySeed: FIT_SEEDS[0], fitSeeds: FIT_SEEDS,
  weightHashes: Object.fromEntries(fits.map(fit => [fit.seed, fit.digest])),
  previousHash: previous.hash, overrideHash: override.hash, uncertaintyHash: uncertainty.hash, banks: {}, splits: {}};

function versus(rows, baseline, summary) {
  return Object.fromEntries(LOSS_REFERENCES.map(name => [name, name === "rl" ? summary.all.comparisons[baseline] :
    pairedFleetComparison(rows.map(row => ({family: row.family, agent: row[name], [baseline]: row[baseline]})), baseline)]));
}

for (const split of LOSS_SPLITS) {
  const cases = lossCases(split).map(config => {
    const records = Object.fromEntries(Object.entries(refs).map(([name, policy]) => [name, score(config, policy)]));
    return {...config, ...records, branches: lossBranches(config, records.rl, weights.current, weights, refs)};
  });
  results.banks[split] = await artifact(dir, mode, split + ".json", {suite: LOSS_SUITE, split, cases});
  const rows = cases.map(row => ({family: row.family, agent: row.rl.ledger,
    ...Object.fromEntries(LOSS_REFERENCES.map(name => [name, row[name].ledger]))}));
  const summary = summarizeLoss(rows);
  const replicates = fits.map(({seed, checkpoint}) => {
    const decide = makeLossPolicy(checkpoint, weights.override, weights.uncertainty);
    const weeks = seed === FIT_SEEDS[0] ? rows : cases.map((config, i) => ({...rows[i], agent: score(config, decide).ledger}));
    return {seed, net: weeks.reduce((s, w) => s + w.agent.net, 0) / weeks.length,
      onTime: 10 * weeks.reduce((s, w) => s + w.agent.served, 0) / weeks.length,
      planner: pairedFleetComparison(weeks, "planner"), flatRisk: pairedFleetComparison(weeks, "flatRisk")};
  });
  results.splits[split] = {summary, fits: replicates, versusPlanner: versus(rows, "planner", summary),
    versusFlatRisk: versus(rows, "flatRisk", summary), diagnostics: summarizeLossDecisions(cases, weights.current)};
  console.log("Scored", split, cases.length, "weeks, seven dispatchers, five fits and proposal forks.");
}
const fresh = results.splits.test.summary.all;
const doubleReturn = results.splits.archive.summary.all.earnsMoreThanPlanner;
results.goals = {freshProfit: fresh.earnsMoreThanPlanner, freshService: fresh.matchesPlannerService,
  freshFlatProfit: fresh.earnsMoreThanFlatRisk, freshFlatService: fresh.matchesFlatRiskService,
  doubleReturn, joint: fresh.beatsPlanner && fresh.beatsFlatRisk && doubleReturn};
await artifact(dir, mode, "results.json", results);
console.log(mode === "--check" ? "Reproduced all scored artifacts." : "Recorded all loss study artifacts.");
