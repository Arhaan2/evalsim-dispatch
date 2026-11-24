import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { benchmarkDrift, driftReferences, verifyDriftReport } from "../docs/lib/drift-benchmark.js";
import { verifyReserveReport } from "../docs/lib/reserve-benchmark.js";
import { driftCases } from "../docs/lib/drift.js";

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url)));
const release = await json("../docs/data/drift/results.json");
const reserve = await json("../docs/data/reserve/results.json");
const weights = { drift: release.checkpoint.weights, legacy: reserve.checkpoint.weights };
const cwd = fileURLToPath(new URL("../", import.meta.url));
const cli = args => spawnSync(process.execPath, ["tools/reserve.mjs", ...args], { cwd, encoding: "utf8", timeout: 30000 });

test("the public drift benchmark matches every frozen policy, planner and original RL result", async () => {
  const refs = driftReferences(weights);
  const report = await benchmarkDrift({
    policy: "released", weights, createPolicy: () => {
      let seen = 0;
      return async (observation, calls) => {
        assert.equal(observation.wave, seen++);
        assert.equal(observation.history.length, observation.wave);
        for (const key of ["seed", "family", "pattern", "split"]) assert.ok(!(key in observation));
        const action = refs.rl(observation);
        assert.ok(calls.some(call => call.id === action));
        return action;
      };
    },
  });
  assert.equal(report.cases.length, 768);
  for (const [i, row] of report.cases.entries()) {
    const expected = release.cases[i];
    for (const key of ["seed", "family", ...Object.keys(refs)]) assert.equal(row[key], expected[key]);
    assert.equal(row.net, expected.rl);
  }
  assert.deepEqual(report.summary.all.references.stochastic, { mean: release.comparisons.all.stochastic, ...release.comparisons.all.rlMinusStochastic });
  assert.deepEqual(await verifyDriftReport(report, weights), report);
  await assert.rejects(verifyReserveReport(report, weights.legacy));
});

test("CLI suite selection uses the public manifest, detects cross-suite replay and rejects altered scores", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evalsim-drift-"));
  try {
    const path = join(dir, "result.json");
    const args = ["--suite", "drift", "--split", "validation"];
    assert.deepEqual(JSON.parse(cli([...args, "--manifest"]).stdout).cases, driftCases("validation"));
    const result = cli([...args, "--policy", "./examples/reserve-agent.mjs", "--out", path]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(cli(["--verify", path]).status, 0);
    assert.equal(cli(["--suite", "reserve", "--verify", path]).status, 1);
    const report = JSON.parse(await readFile(path));
    report.cases[0].adaptive++;
    await writeFile(path, JSON.stringify(report));
    assert.equal(cli(["--verify", path]).status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
