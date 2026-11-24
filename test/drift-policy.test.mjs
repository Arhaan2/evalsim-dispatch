import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adaptivePlanner, createDrift, driftCases, observeDrift, stepDrift, stochasticPlanner, verifyDrift } from "../docs/lib/drift.js";
import { chooseDrift, driftFeatures } from "../docs/lib/drift-policy.js";
import { chooseReserve, pairedReserve, reserveStateKey } from "../docs/lib/reserve-policy.js";

const report = JSON.parse(readFileSync(new URL("../docs/data/drift/results.json", import.meta.url)));
const legacy = JSON.parse(readFileSync(new URL("../docs/data/reserve/results.json", import.meta.url))).checkpoint.weights;
const learned = obs => chooseDrift(obs, report.checkpoint.weights);

test("released checkpoint and all three comparison policies reproduce each frozen OOD tape", () => {
  assert.deepEqual(report.cases.map(({seed, family}) => ({seed, family})), driftCases("test").map(({seed, family}) => ({seed, family})));
  let eligible = 0, hits = 0;
  const operators = { rl: learned, stochastic: stochasticPlanner, adaptive: adaptivePlanner, legacy: obs => {
    if (obs.slots) {
      eligible++;
      if (Object.hasOwn(legacy, reserveStateKey(obs))) hits++;
    }
    return chooseReserve(obs, legacy);
  }};
  for (const row of report.cases) {
    for (const [name, decide] of Object.entries(operators)) {
      const state = createDrift(row);
      let observation = observeDrift(state);
      while (!observation.done) observation = stepDrift(state, decide(observation));
      assert.equal(learned(observation), null);
      const result = verifyDrift(state);
      assert.equal(result.net, row[name]);
      assert.deepEqual(result.violations, []);
    }
  }
  assert.deepEqual(report.legacyCoverage, { eligibleDecisions: eligible, tableHits: hits });
  assert.deepEqual(report.comparisons.all.rlMinusStochastic, pairedReserve(report.cases, "rl", "stochastic"));
  assert.equal(report.checkpoint.trainingSeed, report.protocol.releaseSeed);
});

test("features use a signed offer's historical forecast error, independent of case labels", () => {
  const state = createDrift({family: "step-up", seed: 8100000});
  const obs = stepDrift(state, "pass");
  const alternative = structuredClone(obs);
  const past = alternative.history[0];
  past.high = !past.high;
  past.offer.net = past.high ? past.quote.high : past.quote.low;
  past.offer.revenue = past.offer.net + past.offer.cost;
  assert.notDeepEqual(driftFeatures(obs), driftFeatures(alternative));
  assert.deepEqual(driftFeatures(obs), driftFeatures({ ...obs, family: "irrelevant", seed: 42, hidden: 1 }));
});
