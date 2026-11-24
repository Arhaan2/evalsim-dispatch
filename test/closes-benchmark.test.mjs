import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { benchmarkCloses, closesReferences, verifyClosesReport } from "../docs/lib/closes-benchmark.js";
import { verifyTurnsReport } from "../docs/lib/turns-benchmark.js";

async function release(name) {
  return JSON.parse(await readFile(new URL("../docs/data/" + name + "/results.json", import.meta.url)));
}
const [study, turns, drift] = await Promise.all(["closes", "turns", "drift"].map(release));
const weights = { closes: study.checkpoint.weights, ablated: study.checkpoint.ablatedWeights,
  turns: turns.checkpoint.weights, drift: drift.checkpoint.weights };

test("a public agent gets all matched endings and reproduces every released policy score", async () => {
  for (const [split, rows] of [["test", study.cases], ["retention", study.guard.cases]]) {
    const refs = closesReferences(weights);
    const report = await benchmarkCloses({ split, policy: "release", weights, createPolicy: () => refs.rl });
    assert.equal(report.cases.length, rows.length);
    for (const [i, row] of rows.entries()) {
      const actual = report.cases[i];
      assert.equal(actual.seed, row.seed);
      assert.equal(actual.family, row.family);
      assert.equal(actual.net, row.rl);
      for (const key of Object.keys(refs)) assert.equal(actual[key], row[key], row.family + " " + key);
    }
    if (split === "test") {
      for (const stratum of ["reversal", "interrupted-drop"]) {
        for (const ending of ["hot", "cold"]) {
          const pair = report.summary.byStratumEnding[stratum][ending];
          assert.equal(pair.shifts, 1024);
          const published = study.comparisons.byStratumEnding[stratum][ending];
          assert.deepEqual(pair.references.stochastic.interval95, published.rlMinusStochastic.interval95);
          assert.deepEqual(pair.references.ablated.interval95, published.rlMinusAblated.interval95);
        }
      }
      assert.equal(report.summary.byEnding.hot.shifts, report.summary.byEnding.cold.shifts);
    } else {
      assert.equal(report.summary.byEnding.cold.shifts, 1536);
      assert.equal(report.summary.byEnding.hot, undefined);
      assert.equal(Object.keys(report.summary.byFamily).length, 3);
    }
    assert.deepEqual(await verifyClosesReport(report, weights), report);
    await assert.rejects(verifyTurnsReport(report, {}), /suite version/);
    report.summary.byEnding.cold.mean++;
    await assert.rejects(verifyClosesReport(report, weights), /differ/);
  }
});
