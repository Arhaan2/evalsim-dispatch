import assert from "node:assert/strict";
import test from "node:test";
import { RESERVE_FAMILIES, createReserve, observeReserve, reserveCalls, stepReserve,
  verifyReserve, pointPlanner, stochasticPlanner } from "../docs/lib/reserve.js";

function play(config, policy) {
  const shift = createReserve(config);
  while (!shift.done) {
    const o = observeReserve(shift);
    const action = policy(o);
    assert(reserveCalls(o).some(call => call.id === action));
    stepReserve(shift, action);
  }
  return shift;
}

test("Reserve signs a fixed sequence of freight, independent of the dispatcher's calls", () => {
  const config = { seed: 15, family: "surge" };
  const full = createReserve(config), empty = createReserve(config);
  const signed = [];
  while (!empty.done) {
    const a = observeReserve(full), b = observeReserve(empty);
    assert.deepEqual(a.offer, b.offer);
    assert.deepEqual(a.forecast, b.forecast);
    signed.push(a.offer.net);
    stepReserve(full, a.slots ? "accept" : "pass");
    stepReserve(empty, "pass");
  }
  assert.deepEqual(signed, [12, 12, 11, 32, 2, 2, 2, 32]);
  assert.deepEqual(verifyReserve(full), { net: 24, accepted: 2, usedSlots: 2, capacity: 2, waves: 8, violations: [] });
  assert.equal(verifyReserve(empty).net, 0);
  assert.deepEqual(reserveCalls(observeReserve(empty)), []);
});

test("a public opening and its forecast can lead to different freight arrivals", () => {
  const shifts = [0, 15].map(seed => createReserve({ seed, family: "surge" }));
  const o = observeReserve(shifts[0]);
  assert.deepEqual(Object.keys(o).sort(), ["capacity", "done", "forecast", "horizon", "net", "offer", "slots", "wave"]);
  assert.deepEqual(Object.keys(o.offer).sort(), ["cost", "lane", "net", "revenue"]);
  for (const f of o.forecast) {
    assert.deepEqual(Object.keys(f).sort(), ["high", "highChance", "low", "mean"]);
    assert(f.highChance >= 0 && f.highChance <= 1);
    assert.equal(f.mean, f.low + (f.high - f.low) * f.highChance);
  }
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(observeReserve(shifts[0]), observeReserve(shifts[1]));
    for (const s of shifts) stepReserve(s, "pass");
  }
  assert.notEqual(observeReserve(shifts[0]).offer.net, observeReserve(shifts[1]).offer.net);
});

test("bad decisions and changes to returned observations cannot alter the simulator", () => {
  const s = createReserve({ seed: 1, family: "volatile" }), before = structuredClone(s);
  const o = observeReserve(s);
  o.offer.net = 200;
  o.forecast[0].highChance = -1;
  o.forecast.pop();
  assert.throws(() => stepReserve(s, "hold"), RangeError);
  assert.deepEqual(s, before);
  stepReserve(s, "accept");
  const noSlots = stepReserve(s, "accept");
  assert.deepEqual(reserveCalls(noSlots).map(c => c.id), ["pass"]);
  const filled = structuredClone(s);
  assert.throws(() => stepReserve(s, "accept"), RangeError);
  assert.deepEqual(s, filled);
  while (!s.done) stepReserve(s, "pass");
  assert.throws(() => stepReserve(s, "pass"), RangeError);
  assert.equal(observeReserve(s).offer, null);
  assert.deepEqual(observeReserve(s).forecast, []);
  for (const cfg of [{ seed: -1 }, { seed: 0x100000000 }, { seed: "1" }, { seed: 1, family: "constructor" }]) {
    assert.throws(() => createReserve(cfg), RangeError);
  }
});

test("reserve ledger reconciles signed agreements, calls, clock, capacity and net", () => {
  const end = play({ seed: 4, family: "volatile" }, stochasticPlanner);
  assert.deepEqual(verifyReserve(end).violations, []);
  for (const corrupt of [
    s => { s.net++; },
    s => { s.loads[0].cost--; s.loads[0].revenue--; },
    s => { s.loads[0].wave = s.loads[1].wave; },
    s => { s.calls[0].wave = 1; },
    s => { s.calls[0].id = "inspect"; },
    s => { s.slots++; },
    s => { s.done = false; },
  ]) {
    const edited = structuredClone(end);
    corrupt(edited);
    assert(verifyReserve(edited).violations.length > 0);
  }
});

// Enumerate all feasible decisions and future offers on a small board. Decisions
// precede future draws; the maximization uses no knowledge of the next realization.
function actionValues(current, forecast, slots) {
  if (!slots) return { pass: 0 };
  function next(capacity) {
    if (!capacity || !forecast.length) return 0;
    const [law, ...later] = forecast;
    const low = actionValues(law.low, later, capacity);
    const high = actionValues(law.high, later, capacity);
    return (1 - law.highChance) * Math.max(low.accept, low.pass)
      + law.highChance * Math.max(high.accept, high.pass);
  }
  return { accept: current + next(slots - 1), pass: next(slots) };
}

test("stochastic planner matches exhaustive nonanticipating decisions on small subproblems", () => {
  for (const family of RESERVE_FAMILIES) {
    const s = createReserve({ seed: 42, family });
    while (s.wave < 4) stepReserve(s, "pass");
    const base = observeReserve(s);
    for (const slots of [1, 2]) {
      for (let net = 1; net <= 39; net++) {
        const o = { ...base, slots, offer: { net } };
        const q = actionValues(net, o.forecast, slots);
        assert.equal(q[stochasticPlanner(o)], Math.max(q.accept, q.pass));
      }
    }
  }
});

test("point planner optimizes remaining mean prices, and both planners attain the steady ceiling", () => {
  for (const family of RESERVE_FAMILIES) {
    const s = createReserve({ seed: 0, family });
    while (!s.done) {
      const o = observeReserve(s), values = o.forecast.map(f => f.mean);
      const top = (numbers, slots) => numbers.toSorted((a, b) => b - a).slice(0, slots).reduce((sum, n) => sum + n, 0);
      for (const slots of [1, 2]) {
        const opt = top([o.offer.net, ...values], slots);
        const action = pointPlanner({ ...o, slots });
        const booked = o.offer.net + top(values, slots - 1);
        assert.equal(action === "accept" ? booked : top(values, slots), opt);
      }
      stepReserve(s, "pass");
    }
  }
  for (const seed of [0, 1, 15, 42, 0xffffffff]) {
    for (const planner of [pointPlanner, stochasticPlanner]) {
      const record = verifyReserve(play({ seed, family: "steady" }, planner));
      assert.equal(record.net, 25);
      assert.deepEqual(record.violations, []);
    }
  }
});
