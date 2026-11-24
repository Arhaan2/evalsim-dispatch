import test from "node:test";
import assert from "node:assert/strict";
import { createShift, observeShift, availableCalls, stepShift, planner, noCheck, verifyShift, rewardShift } from "../docs/lib/cutoff.js";
import { casesFor } from "../training/cutoff/protocol.mjs";
import { chooseCutoff } from "../docs/lib/cutoff-policy.js";
import { readFileSync } from "node:fs";

function finish(config, select) {
  const s = createShift(config);
  while (!s.done) {
    const obs = observeShift(s), id = select(obs);
    assert(availableCalls(obs).some(action => action.id === id));
    stepShift(s, id);
  }
  return s;
}

test("uncertain twins are observationally identical until the inventory inspection", () => {
  for (const split of ["train", "validation", "test"]) {
    for (const seed of [0, 3, 17, 4294967295]) {
      const twins = [0, 1].map(variant => createShift({ seed, split, variant, family: "uncertain" }));
      const [a, b] = twins.map(observeShift);
      assert.deepEqual(a, b);
      assert.deepEqual(availableCalls(a), availableCalls(b));
      const [left, right] = twins.map(s => stepShift(s, "inspect"));
      assert.equal(left.spent, 1);
      assert.equal(right.tick, 1);
      assert.deepEqual(left.yards.map(y => y.reportedStock), [left.orders[0].units, 0]);
      assert.deepEqual(right.yards.map(y => y.reportedStock), [0, right.orders[1].units]);
      assert.equal(planner(left), "express-1");
      assert.equal(planner(right), "express-0");
    }
  }
});

test("inspection on an urgent opening forfeits the express window", () => {
  const s = createShift({ seed: 43, family: "urgent" });
  const before = observeShift(s);
  assert(before.yards.every(y => y.confirmed));
  assert(availableCalls(before).some(c => c.id === "inspect"));
  stepShift(s, "inspect");
  assert(availableCalls(observeShift(s)).every(c => !c.id.startsWith("express-")));
  while (!s.done) stepShift(s, planner(observeShift(s)));
  const m = verifyShift(s);
  assert.equal(m.success, false);
  assert(m.onTimeUnits > 0);
  assert.deepEqual(m.violations, []);
});

test("policy observations cannot mutate the shift, invalid calls make no changes", () => {
  const s = createShift({ seed: 10, split: "test", variant: 1 });
  const before = structuredClone(s), o = observeShift(s);
  o.orders[0].units = -1;
  o.yards[1].reportedStock = 12;
  o.events[0].text = "";
  assert.throws(() => stepShift(s, "local-0"), RangeError);
  assert.deepEqual(s, before);
});

test("a ledger rejects inconsistent freight, missing charges and double allocation", () => {
  const complete = finish({ seed: 52, split: "test", variant: 0 }, planner);
  assert(verifyShift(complete).success);
  for (const mutate of [s => s.trips[0].quantity++, s => s.trips[0].arrival++, s => s.stock[0]++,
    s => s.calls.find(c => c.id === "inspect").cost++, s => s.trips.push({ ...s.trips[0] })]) {
    const s = structuredClone(complete);
    mutate(s);
    const m = verifyShift(s);
    assert(m.violations.length);
    assert.equal(m.success, false);
  }
});

test("planner feasibility, twin behavior and deterministic published operator on the frozen suite", () => {
  const results = JSON.parse(readFileSync(new URL("../docs/data/cutoff/results.json", import.meta.url)));
  const suite = casesFor("test");
  let without = 0, learnedSuccess = 0;
  for (const config of suite) {
    const m = verifyShift(finish(config, planner));
    assert(m.success);
    assert(m.spend <= 7);
    assert(Number.isFinite(rewardShift(m)));
    without += verifyShift(finish(config, noCheck)).success;
    learnedSuccess += verifyShift(finish(config, o => chooseCutoff(o, results.checkpoints.uniform.weights))).success;
  }
  assert.equal(without, 144);
  assert.equal(learnedSuccess, results.runs.find(r => r.mode === "uniform" && r.seed === results.protocol.reportCheckpointSeed).final.successes);
});

test("public scenario options reject unsupported inputs", () => {
  for (const config of [{ seed: -1 }, { seed: 4294967296 }, { seed: 0, split: "toString" },
    { seed: 1, variant: "1" }, { seed: 7, family: "unknown" }]) assert.throws(() => createShift(config), RangeError);
});
