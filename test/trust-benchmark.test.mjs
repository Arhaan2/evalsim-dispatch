import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { benchmarkTrust, trustReferences, trustWeights, verifyTrustReport } from "../docs/lib/trust-benchmark.js";
import { verifyClosesReport } from "../docs/lib/closes-benchmark.js";

async function readRelease(name) {
  return JSON.parse(await readFile(new URL("../docs/data/" + name + "/results.json", import.meta.url)));
}
const releases = await Promise.all(["trust", "closes", "drift", "turns"].map(readRelease));
const weights = trustWeights(...releases);
const [study] = releases;

test("the local routing benchmark replays every reference and the paired endpoint intervals", async () => {
  const refs = trustReferences(weights);
  for (const [split, cases, comparisons] of [
    ["test", study.cases, study.comparisons],
    ["retention", study.guard.cases, study.guard.comparisons],
    ["archive", study.archive.cases, study.archive.comparisons],
  ]) {
    const report = await benchmarkTrust({ split, policy: "two-expert", weights, createPolicy: () => refs.binary });
    assert.equal(report.cases.length, cases.length);
    for (const [i, actual] of report.cases.entries()) {
      const expected = cases[i];
      assert.equal(actual.net, expected.binary);
      assert.equal(actual.seed, expected.seed);
      assert.equal(actual.family, expected.family);
      for (const key of Object.keys(refs)) assert.equal(actual[key], expected[key], key);
    }
    for (const [stratum, endings] of Object.entries(report.summary.byStratumEnding)) {
      for (const [ending, group] of Object.entries(endings)) {
        const published = comparisons.byStratumEnding[stratum][ending];
        assert.equal(group.shifts, published.count);
        assert.deepEqual(group.references.stochastic.interval95, published.binaryMinusStochastic.interval95);
        assert.deepEqual(group.references.closes.interval95, published.binaryMinusCloses.interval95);
      }
    }
    if (split === "retention") {
      assert.deepEqual(await verifyTrustReport(report, weights), report);
      await assert.rejects(verifyClosesReport(report, {}), /suite version/);
      report.cases[0].closes++;
      await assert.rejects(verifyTrustReport(report, weights), /differ/);
    }
  }
});
