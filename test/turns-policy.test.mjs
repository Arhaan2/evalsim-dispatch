import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chooseTurns, turnsSignal, turnsThreshold } from "../docs/lib/turns-policy.js";
import { chooseDrift } from "../docs/lib/drift-policy.js";
import { createDrift, observeDrift, stepDrift, verifyDrift } from "../docs/lib/drift.js";
import {
  adaptivePlanner, createTurns, observeTurns, stepTurns, stochasticPlanner, turnsCases, verifyTurns,
} from "../docs/lib/turns.js";
import { pairedReserve } from "../docs/lib/reserve-policy.js";

const load = async path => JSON.parse(await readFile(new URL(path, import.meta.url)));
const release = await load("../docs/data/turns/results.json");
const prior = (await load("../docs/data/drift/results.json")).checkpoint.weights;
const { weights, ablatedWeights } = release.checkpoint;
const policies = {
  rl: o => chooseTurns(o, weights), drift: o => chooseDrift(o, prior),
  ablated: o => chooseTurns(o, ablatedWeights), stochastic: stochasticPlanner, adaptive: adaptivePlanner,
};

test("all five policy scores reproduce from signed loads for the fresh suite and original diagnostics", () => {
  assert.deepEqual(release.cases.map(({family, seed}) => [family, seed]),
    turnsCases("test").map(({family, seed}) => [family, seed]));
  assert.deepEqual(release.guard.cases.map(({family, seed}) => [family, seed]),
    turnsCases("retention").map(({family, seed}) => [family, seed]));
  assert.deepEqual(release.originalReversal.cases.map(({family, seed}) => [family, seed]),
    release.guard.cases.map(({seed}) => ["reversal", seed]));
  for (const [rows, create, observe, step, verify] of [
    [release.cases, createTurns, observeTurns, stepTurns, verifyTurns],
    [release.guard.cases, createDrift, observeDrift, stepDrift, verifyDrift],
    [release.originalReversal.cases, createDrift, observeDrift, stepDrift, verifyDrift],
  ]) {
    for (const row of rows) {
      for (const [id, decide] of Object.entries(policies)) {
        const state = create(row);
        while (!state.done) step(state, decide(observe(state)));
        const score = verify(state);
        assert.deepEqual(score.violations, []);
        assert.equal(score.net, row[id]);
      }
    }
  }
});

test("matched public contexts differ only in historical evidence relevant to the full estimator", () => {
  function observation(example) {
    const state = createTurns(example);
    while (state.wave < example.wave) stepTurns(state, policies.rl(observeTurns(state)));
    return observeTurns(state);
  }
  const example = release.sensitivity.firstExample;
  assert.ok(example);
  const book = observation(example.accept), pass = observation(example.pass);
  for (const key of ["wave", "slots", "offer", "quote", "forecast"]) assert.deepEqual(book[key], pass[key]);
  assert.notDeepEqual(book.history, pass.history);
  assert.deepEqual(turnsSignal(book), example.accept.signal);
  assert.deepEqual(turnsSignal(pass), example.pass.signal);
  assert.ok(turnsThreshold(book, weights) < turnsThreshold(pass, weights));
  assert.equal(policies.rl(book), "accept");
  assert.equal(policies.rl(pass), "pass");
  assert.equal(turnsThreshold(book, ablatedWeights), turnsThreshold(pass, ablatedWeights));
});

test("paired retention checks apply the declared margin independently on new and original drops", () => {
  const freshRebounds = release.cases.filter(row => row.family.endsWith("-rebound"));
  const crests = release.cases.filter(row => row.family.endsWith("-crest"));
  const passes = (rows, ref, floor) => pairedReserve(rows, "rl", ref).interval95[0] > floor;
  const retain = rows => passes(rows, "stochastic", 0) && passes(rows, "drift", -release.protocol.retentionMargin);
  const checks = { beatsPlanner: passes(release.cases, "stochastic", 0), repairsReversals: passes(crests, "drift", 0),
    freshDropRetention: retain(freshRebounds), originalDropRetention: retain(release.guard.cases) };
  assert.deepEqual(release.checks, { ...checks, joint: Object.values(checks).every(Boolean) });
});
