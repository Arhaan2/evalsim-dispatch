import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createReserve, observeReserve, stepReserve, verifyReserve } from "../docs/lib/reserve.js";
import { chooseReserve, pairedReserve, reserveCases, RESERVE_SUITE, summarizeReserve } from "../docs/lib/reserve-policy.js";

const report = JSON.parse(readFileSync(new URL("../docs/data/reserve/results.json", import.meta.url)));

test("Reserve manifest spans disjoint splits and covers every frozen row in the declared order", () => {
  const { train, validation, test: heldOut } = RESERVE_SUITE.splits;
  assert.ok(train.start + train.count <= validation.start);
  assert.ok(validation.start + validation.count <= heldOut.start);
  assert.throws(() => reserveCases("unknown"), /Unknown Reserve split/);
  assert.deepEqual(report.cases.map(({seed, family}) => ({seed, family})),
    reserveCases().map(({seed, family}) => ({seed, family})));
  assert.deepEqual(report.comparisons, summarizeReserve(report.cases));
});

test("paired bootstrap keeps families sharing an exogenous seed in the same draw", () => {
  const sample = [
    {seed: 1, a: 3, b: 1}, {seed: 2, a: 0, b: 1},
    {seed: 1, a: 0, b: 2}, {seed: 2, a: 2, b: 1},
  ];
  assert.deepEqual(pairedReserve(sample, "a", "b"),
    {delta: 0, interval95: [0, 0], wins: 2, ties: 0, losses: 2});
  assert.deepEqual(pairedReserve([...sample].reverse(), "a", "b"), pairedReserve(sample, "a", "b"));
  assert.throws(() => pairedReserve([], "a", "b"));
  assert.throws(() => pairedReserve([{ seed: 1, a: NaN, b: 3 }], "a", "b"));
});

test("released Reserve policy reproduces every published held-out score through simulator calls", () => {
  for (const row of report.cases) {
    const state = createReserve(row);
    let obs = observeReserve(state);
    while (!obs.done) obs = stepReserve(state, chooseReserve(obs, report.checkpoint.weights));
    assert.equal(chooseReserve(obs, report.checkpoint.weights), null);
    const result = verifyReserve(state);
    assert.deepEqual(result.violations, []);
    assert.equal(result.net, row.rl);
  }
});
