import assert from "node:assert/strict";
import test from "node:test";
import { adaptivePlanner, createDrift, DRIFT_PATTERNS, DRIFT_SUITE, driftCases, observeDrift,
  reserveCalls, stepDrift, stochasticPlanner, verifyDrift } from "../docs/lib/drift.js";
import { stochasticPlanner as originalPlanner } from "../docs/lib/reserve.js";

test("all held-out patterns reverse direction after the common opening; no development pattern does", () => {
  const names = Object.values(DRIFT_SUITE.splits).flatMap(split => split.families);
  assert.equal(new Set(names).size, names.length);
  const shapes = names.map(name => DRIFT_PATTERNS[name].levels);
  assert.equal(new Set(shapes.map(shape => shape.join(","))).size, names.length);
  for (const [split, spec] of Object.entries(DRIFT_SUITE.splits)) {
    for (const name of spec.families) {
      const levels = DRIFT_PATTERNS[name].levels;
      assert.equal(levels.length, 8);
      assert.equal(levels[0], 2);
      const signs = new Set(levels.slice(2).map((level, i) => Math.sign(level - levels[i + 1])).filter(Boolean));
      assert.equal(signs.size, split === "test" ? 2 : 1, name);
    }
  }
  const validation = driftCases("validation"), testCases = driftCases("test");
  assert.equal(validation.length, 128);
  assert.equal(testCases.length, 768);
  assert.deepEqual(testCases.slice(0,3).map(row => row.family), DRIFT_SUITE.splits.test.families);
  assert.equal(testCases.at(-1).seed, 8300255);
  assert.equal(validation.at(-1).seed, 8200063);
  assert.throws(() => driftCases("constructor"), RangeError);
});

test("opening forecasts, observed price and future supports do not identify the hidden path", () => {
  for (const seed of [0, 47, 149, 0xffffffff]) {
    const opening = observeDrift(createDrift({ seed }));
    for (const family of Object.keys(DRIFT_PATTERNS)) {
      assert.deepEqual(observeDrift(createDrift({ seed, family })), opening);
    }
    assert.deepEqual(Object.keys(opening).sort(),
      ["capacity", "done", "forecast", "history", "horizon", "net", "offer", "quote", "slots", "wave"]);
    assert.deepEqual(opening.history, []);
    assert.equal(opening.forecast.length, 7);
    for (const law of [opening.quote, ...opening.forecast]) {
      assert.deepEqual(Object.keys(law).sort(), ["high", "highChance", "low", "mean"]);
      assert.equal(law.highChance, opening.quote.highChance);
      assert.equal(law.mean, law.low + (law.high - law.low) * law.highChance);
    }
  }
});

test("the reversal changes the generating probabilities while public bulletins lag", () => {
  const state = createDrift({ seed: 3, family: "reversal" });
  const fullHistory = [];
  for (let wave = 0; wave < 8; wave++) {
    const o = observeDrift(state);
    assert.deepEqual(o.history, fullHistory);
    // Whatever the seed's offers, cold-to-hot reversal at wave 4 and hot-to-cold
    // reversal at wave 7 systematically disagree with the two-wave-old survey.
    if (wave === 3) assert(state.trueHighChances[wave] - o.quote.highChance >= 0.4);
    if (wave === 6) assert(o.quote.highChance - state.trueHighChances[wave] >= 0.4);
    fullHistory.push({ wave, offer: o.offer, quote: o.quote, high: o.offer.net === o.quote.high });
    const after = stepDrift(state, "pass");
    if (![3, 6, 8].includes(after.wave)) assert.equal(after.quote.highChance, o.quote.highChance);
  }
  const end = observeDrift(state);
  assert.deepEqual(end.history, fullHistory);
  assert.deepEqual(end.forecast, []);
  assert.equal(end.quote, null);
  assert.equal(end.offer, null);
});

test("bookings leave market draws and forecast history unchanged across operators", () => {
  const config = { seed: 299, family: "double-pulse" };
  const a = createDrift(config), b = createDrift(config);
  while (!a.done) {
    const booked = observeDrift(a), skipped = observeDrift(b);
    for (const key of ["wave", "quote", "history", "offer", "forecast"]) {
      assert.deepEqual(booked[key], skipped[key], key);
    }
    stepDrift(a, booked.slots ? "accept" : "pass");
    stepDrift(b, "pass");
  }
  assert.equal(verifyDrift(a).accepted, 2);
  assert.equal(verifyDrift(b).net, 0);
  assert.deepEqual(verifyDrift(a).violations, []);
  assert.deepEqual(verifyDrift(b).violations, []);
});

test("agent observations are copies, invalid actions leave the shift intact, ledger detects forged loads", () => {
  const s = createDrift({ seed: 42, family: "interrupted-drop" });
  stepDrift(s, "accept");
  const o = observeDrift(s), original = structuredClone(s);
  o.history[0].offer.net = -1;
  o.history[0].quote.highChance = 1;
  o.offer.lane = "Forged";
  o.forecast[0].high = 999;
  o.quote.highChance = 0;
  assert.throws(() => stepDrift(s, "hold"), RangeError);
  assert.deepEqual(s, original);
  stepDrift(s, "accept");
  assert.deepEqual(reserveCalls(observeDrift(s)).map(call => call.id), ["pass"]);
  assert.throws(() => stepDrift(s, "accept"), RangeError);
  while (!s.done) stepDrift(s, "pass");
  assert.deepEqual(reserveCalls(observeDrift(s)), []);
  assert.throws(() => stepDrift(s, "pass"), RangeError);
  for (const change of [
    copy => copy.net++, copy => copy.slots++, copy => copy.loads[0].revenue++,
    copy => { copy.calls[0].id = "pass"; }, copy => { copy.calls[1].wave = 0; },
    copy => { copy.done = false; },
  ]) {
    const copy = structuredClone(s);
    change(copy);
    assert(verifyDrift(copy).violations.length > 0);
  }
  for (const seed of [-1, 2**32, "42"]) assert.throws(() => createDrift({seed}), RangeError);
  assert.throws(() => createDrift({ seed: 0, family: "__proto__" }), RangeError);
});

test("the original stochastic planner uses issued odds and the adaptive comparator can change its decision from public evidence", () => {
  assert.equal(stochasticPlanner, originalPlanner);
  const base = observeDrift(createDrift({ seed: 3 }));
  const quote = { low: 12, high: 25, highChance: 0.4, mean: 17.2 };
  const forecast = [{ low: 8, high: 24, highChance: 0.4, mean: 14.4 }];
  const decide = (planner, high) => planner({ ...base, slots: 1, wave: 6, offer: { net: 12 }, quote, forecast,
    history: Array.from({ length: 6 }, (_, wave) => ({ wave, high, quote, offer: { net: high ? 25 : 12 } })) });
  assert.equal(decide(stochasticPlanner, false), "pass");
  assert.equal(decide(stochasticPlanner, true), "pass");
  assert.equal(decide(adaptivePlanner, false), "accept");
  assert.equal(decide(adaptivePlanner, true), "pass");
});
