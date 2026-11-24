import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { turnsCases, TURNS_SUITE } from "../docs/lib/turns.js";
import { benchmarkTurns, runTurnsCase, turnsReferences, verifyTurnsReport } from "../docs/lib/turns-benchmark.js";
import { runDriftCase, verifyDriftReport } from "../docs/lib/drift-benchmark.js";
import { chooseTurns } from "../docs/lib/turns-policy.js";

const result = async lab => JSON.parse(await readFile(new URL("../docs/data/" + lab + "/results.json", import.meta.url)));
const release = await result("turns");
const previous = await result("drift");
const weights = { turns: release.checkpoint.weights, drift: previous.checkpoint.weights };
const cwd = fileURLToPath(new URL("../", import.meta.url));
const cli = args => spawnSync(process.execPath, ["tools/reserve.mjs", ...args], { cwd, encoding: "utf8", timeout: 60000 });

test("external-agent runner matches the published rewards on all novel patterns and the retention suite", async () => {
  const decide = turnsReferences(weights).rl;
  for (const [split, records] of [["test", release.cases], ["retention", release.guard.cases]]) {
    const report = await benchmarkTurns({ split, policy: "released", weights, createPolicy: () => decide });
    assert.equal(report.suite, TURNS_SUITE.id);
    assert.equal(report.cases.length, records.length);
    for (const [i, row] of report.cases.entries()) {
      for (const field of ["family", "seed", "rl", "drift", "stochastic", "adaptive"]) {
        assert.equal(row[field], records[i][field], field + " in case " + i);
      }
      assert.equal(row.net, row.rl);
    }
    assert.equal(report.summary.byStratum["interrupted-drop"].shifts, split === "test" ? 512 : 256);
    assert.deepEqual(await verifyTurnsReport(report, weights), report);
    if (split === "test") {
      assert.equal(report.summary.byStratum.reversal.references.drift.delta, release.comparisons.byStratum.reversal.rlMinusDrift.delta);
    } else {
      const config = turnsCases(split)[0];
      assert.deepEqual(await runTurnsCase(config, decide), await runDriftCase(config, decide));
    }
    report.cases[0].drift++;
    await assert.rejects(verifyTurnsReport(report, weights), /differ/);
    await assert.rejects(verifyDriftReport(report, {}), /suite version/);
  }
});

test("the new policy also runs on historical Drift and produces a compatible, independently replayable report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "turns-policy-"));
  try {
    const saved = join(dir, "historical.json");
    const run = cli(["--suite", "drift", "--policy", "turns", "--out", saved]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(await readFile(saved));
    assert.equal(report.suite, "dispatch-drift-v1");
    assert.equal(report.cases.length, 768);
    const first = report.cases[0];
    const played = await runDriftCase(first, obs => chooseTurns(obs, weights.turns));
    assert.deepEqual(first.actions, played.actions);
    assert.equal(first.net, played.score.net);
    assert.equal(cli(["--verify", saved]).status, 0);
    assert.equal(cli(["--suite", "turns", "--verify", saved]).status, 1);
    const args = ["--suite", "turns", "--split", "retention"];
    assert.deepEqual(JSON.parse(cli([...args, "--manifest"]).stdout).cases, turnsCases("retention"));
    assert.equal(cli(["--suite", "drift", "--split", "retention", "--manifest"]).status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
