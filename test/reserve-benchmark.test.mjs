import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { benchmarkReserve, runReserveCase, verifyReserveReport } from "../docs/lib/reserve-benchmark.js";
import { chooseReserve, reserveCases } from "../docs/lib/reserve-policy.js";

const release = JSON.parse(await readFile(new URL("../docs/data/reserve/results.json", import.meta.url)));
const weights = release.checkpoint.weights;
const cwd = fileURLToPath(new URL("../", import.meta.url));
const cli = args => spawnSync(process.execPath, ["tools/reserve.mjs", ...args], { cwd, encoding: "utf8", timeout: 30000 });

test("the public entry point reproduces every official test case and paired reference", async () => {
  const report = await benchmarkReserve({
    policy: "released", weights,
    createPolicy: () => {
      let wave = 0;
      return async (observation, calls) => {
        assert.equal(observation.wave, wave++);
        assert.ok(!("seed" in observation) && !("family" in observation));
        const action = chooseReserve(observation, weights);
        assert.ok(calls.some(call => call.id === action));
        return action;
      };
    },
  });
  const scores = report.cases.map(({ seed, family, net, planner, stochastic }) => ({ seed, family, rl: net, planner, stochastic }));
  assert.deepEqual(scores, release.cases.map(({ seed, family, rl, planner, stochastic }) => ({ seed, family, rl, planner, stochastic })));
  assert.deepEqual(report.summary.all.references.planner, { mean: release.comparisons.all.planner, ...release.comparisons.all.rlMinusPlanner });
  assert.equal(report.summary.all.references.rl.ties, 768);
  assert.deepEqual(await verifyReserveReport(report, weights), report);
});

test("complete reports bind the split, ordered cases, exact action sequence, credits and summaries", async () => {
  const report = await benchmarkReserve({ split: "validation", policy: "pass", weights, createPolicy: () => () => "pass" });
  for (const tamper of [
    r => r.cases.pop(), r => r.cases.reverse(), r => r.split = "test",
    r => r.cases[0].actions.pop(), r => r.cases[0].actions.push("pass"),
    r => r.cases[0].net++, r => r.cases[0].stochastic++, r => r.summary.all.mean++,
  ]) {
    const altered = structuredClone(report);
    tamper(altered);
    await assert.rejects(verifyReserveReport(altered, weights));
  }
  await assert.rejects(runReserveCase(reserveCases("test")[0], () => "invented"), /Unavailable/);
});

test("local JSON Lines agents see only the public interface and write importable reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reserve-agent-"));
  try {
    const path = join(directory, "result.json");
    const source = `
      import { createInterface } from "node:readline";
      let wave = 0;
      for await (const line of createInterface({ input: process.stdin })) {
        const request = JSON.parse(line);
        if (Object.keys(request).sort().join(",") !== "calls,observation") process.exit(10);
        if (request.observation.wave !== wave || "seed" in request.observation) process.exit(11);
        wave = (wave+1) % request.observation.horizon;
        console.log(JSON.stringify({ action:"pass" }));
      }`;
    const run = cli(["--split", "validation", "--name", "external", "--out", path, "--", process.execPath, "--input-type=module", "-e", source]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(await readFile(path, "utf8"));
    assert.equal(report.summary.all.shifts, 192);
    assert.equal(report.summary.all.mean, 0);
    assert.equal(report.policy, "external");
    assert.equal(cli(["--verify", path]).status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a broken external agent stops the run with a nonzero exit and a case identifier", () => {
  const result = cli(["--", process.execPath, "-e", "process.exit(1)"]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /steady shift 7100000/);
});
