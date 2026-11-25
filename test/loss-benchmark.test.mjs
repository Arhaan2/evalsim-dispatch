import assert from "node:assert/strict";
import test from "node:test";
import {FLEET_PATTERNS} from "../docs/lib/fleetweek.js";
import {fleetCases} from "../docs/lib/fleetweek-study.js";
import {OVERNIGHT_PATTERNS} from "../docs/lib/overnight-markets.js";
import {OVERRIDE_PATTERNS} from "../docs/lib/override-markets.js";
import {UNCERTAINTY_PATTERNS} from "../docs/lib/uncertainty-markets.js";
import {overnightCases} from "../docs/lib/overnight-study.js";
import {overrideCases} from "../docs/lib/override-study.js";
import {uncertaintyCases, UNCERTAINTY_SUITE} from "../docs/lib/uncertainty-study.js";
import {LOSS_PATTERNS, LOSS_FAMILIES} from "../docs/lib/loss-markets.js";
import {LOSS_SUITE, LOSS_REFERENCES, LOSS_SPLITS, lossCases, summarizeLoss} from "../docs/lib/loss-study.js";
import {benchmarkLoss, verifyLossReport} from "../docs/lib/loss-benchmark.js";
import {classifyProposals} from "../training/loss/diagnostics.mjs";

test("fresh loss schedules exclude every earlier fleet shape up to a depot relabeling", () => {
  const shapes = [FLEET_PATTERNS, OVERNIGHT_PATTERNS, OVERRIDE_PATTERNS, UNCERTAINTY_PATTERNS, LOSS_PATTERNS].flatMap(Object.values);
  const canonical = text => [...text].map(c => [...new Set(text)].indexOf(c)).join("");
  for (const shape of shapes) assert.match(shape, /^[012]{10}$/);
  assert.equal(new Set(shapes.map(canonical)).size, shapes.length);
  assert.deepEqual(LOSS_FAMILIES.archive, ["double-return"]);
  assert.equal(FLEET_PATTERNS["double-return"], "0011002200");
  const splits = LOSS_SPLITS.map(lossCases);
  assert.deepEqual(splits.map(rows => rows.length), [256, 8192, 4096]);
  const previous = [...fleetCases("test"), ...fleetCases("validation"),
    ...[overnightCases, overrideCases, uncertaintyCases].flatMap(cases => LOSS_SPLITS.flatMap(cases))];
  const all = [...previous, ...splits.flat()].map(row => row.seed);
  assert.equal(new Set(all).size, all.length);
  assert(splits.flat().every(row => row.seed >= 450000000));
  assert.throws(() => lossCases("constructor"));
});

test("Brier and tie-aware ROC treat equal Friday earnings as a nonloss and preserve endpoint bins", () => {
  const scores = classifyProposals([
    {probability: 0, difference: 1}, {probability: 0.4, difference: -1},
    {probability: 0.4, difference: 0}, {probability: 1, difference: -7},
  ], 0.25);
  assert.equal(scores.auc, 0.875);
  assert.equal(scores.ties, 1);
  assert.equal(scores.losses, 2);
  assert.equal(scores.brier, 0.13);
  assert.equal(scores.constantBrier, 0.3125);
  assert.deepEqual(scores.bins.map(b => [b.n,b.losses]), [[1,0], [0,0], [2,1], [0,0], [1,1]]);
  for (const difference of [-3, 0, 3]) assert.equal(classifyProposals([{probability: 0.7, difference}], 0.25).auc, null);
  const empty = classifyProposals([], 0.25);
  assert.equal(empty.brier, null);
  assert.equal(empty.auc, null);
  assert(empty.bins.every(b => b.meanPredicted === null && b.lossRate === null));
});

test("a positive profit point estimate cannot substitute for either zero-margin service requirement", () => {
  const fixture = (net, served) => {
    const base = {net: 8, served: 5, contracts: 10, gross: 178, penalty: 170, loadedCost: 0, emptyCost: 0, emptyMiles: 0};
    return {family: "synthetic", ...Object.fromEntries(LOSS_REFERENCES.map(name => [name, base])),
      flatRisk: {...base, net: 9, gross: 179}, agent: {...base, net, served, penalty: 34*(10-served), gross: net+34*(10-served)}};
  };
  const equal = summarizeLoss([fixture(9,5)]).all;
  assert.equal(equal.beatsPlanner, true);
  assert.equal(equal.beatsFlatRisk, false);
  assert.equal(equal.matchesFlatRiskService, true);
  const lessService = summarizeLoss([fixture(10,4), fixture(10,6)]).all;
  assert.equal(lessService.comparisons.planner.servicePP, 0);
  assert(lessService.comparisons.flatRisk.service95[0] < 0);
  assert.equal(lessService.matchesPlannerService, false);
  assert.equal(lessService.matchesFlatRiskService, false);
  assert.equal(summarizeLoss([fixture(10,5)]).all.beatsFlatRisk, true);
});

test("replay requires the release bank and exact case manifest before accepting an agent", async () => {
  const cases = lossCases("validation").reverse();
  const bank = {suite: LOSS_SUITE, split: "validation", cases};
  const report = {suite: LOSS_SUITE, version: 1, split: "validation", cases};
  assert.throws(() => verifyLossReport(report, null, bank), /manifest mismatch/);
  assert.throws(() => verifyLossReport({...report, suite: UNCERTAINTY_SUITE}, null, bank), /Unrecognized/);
  await assert.rejects(benchmarkLoss({split: "validation", bank, createPolicy() {assert.fail("unexpected evaluation");}}),
    /manifest mismatch/);
});
