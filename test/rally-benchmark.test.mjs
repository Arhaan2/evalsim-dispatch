import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { benchmarkRally, rallyReferences, rallyWeights, verifyRallyReport } from "../docs/lib/rally-benchmark.js";
import { verifyTrustReport } from "../docs/lib/trust-benchmark.js";

const releases = await Promise.all(["rally", "trust", "closes", "drift", "turns"].map(async name =>
  JSON.parse(await readFile(new URL("../docs/data/" + name + "/results.json", import.meta.url)))));
const [release] = releases;
const weights = rallyWeights(...releases);
const refs = rallyReferences(weights);

test("Rally's external agent interface reproduces the release and target intervals", async () => {
  for (const [split, result] of [["test", release], ["retention", release.guard], ["archive", release.archive]]) {
    const report = await benchmarkRally({ split, policy: "persistence", weights, createPolicy: () => refs.rl });
    assert.equal(report.cases.length, result.cases.length);
    for (const [index, row] of report.cases.entries()) {
      const expected = result.cases[index];
      assert.equal(row.seed, expected.seed);
      assert.equal(row.family, expected.family);
      assert.equal(row.net, expected.rl);
      assert.equal(row.actions.length, 8);
      for (const key of Object.keys(refs)) assert.equal(row[key], expected[key], key);
    }
    for (const [stratum, endings] of Object.entries(report.summary.byStratumEnding)) {
      for (const [ending, group] of Object.entries(endings)) {
        const published = result.comparisons.byStratumEnding[stratum][ending];
        assert.equal(group.shifts, published.count);
        for (const [key, field] of [["stochastic", "rlMinusStochastic"], ["trust", "rlMinusTrust"], ["drift", "rlMinusDrift"]]) {
          assert.deepEqual(group.references[key].interval95, published[field].interval95);
        }
      }
    }
    if (split === "retention") {
      assert.deepEqual(await verifyRallyReport(report, weights), report);
      await assert.rejects(verifyTrustReport(report, {}), /suite version/);
      report.cases[0].net++;
      await assert.rejects(verifyRallyReport(report, weights), /differ/);
    }
  }
});

test("the public scorecard applies the frozen criteria to both weak strata independently", () => {
  const c = release.comparisons.byStratumEnding;
  assert.equal(release.checks.coldReversals, c.reversal.cold.rlMinusStochastic.interval95[0] > 0);
  assert.equal(release.checks.hotDrops, c["interrupted-drop"].hot.rlMinusStochastic.interval95[0] > 0);
  const original = release.guard.comparisons.all;
  assert.equal(release.checks.originalDrop, original.rlMinusStochastic.interval95[0] > 0 &&
    [original.rlMinusTrust, original.rlMinusDrift, original.rlMinusTurns].every(x => x.interval95[0] > -1));
  for (const w of release.diagnostic.byWave) {
    assert.equal(w.count, release.cases.length);
    assert.ok(w.brier >= 0 && w.brier <= 1 && w.accuracy >= 0 && w.accuracy <= 1);
  }
  assert.equal(release.diagnostic.byWave[0].accuracy, 0.5);
});
