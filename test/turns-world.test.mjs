import assert from "node:assert/strict";
import test from "node:test";
import { createDrift, DRIFT_PATTERNS, DRIFT_SUITE, observeDrift, stepDrift, verifyDrift } from "../docs/lib/drift.js";
import { createTurns, observeTurns, reserveCalls, stepTurns, TURNS_PATTERNS, TURNS_SUITE, turnsCases, verifyTurns } from "../docs/lib/turns.js";

const splitSpecs = TURNS_SUITE.splits;
function transitions(levels) {
  return levels.slice(1).map((v, i) => Math.sign(v - levels[i])).join(",");
}

test("held-out paths change at distinct times from every training, validation and prior Drift path", () => {
  const known = Object.values(DRIFT_PATTERNS).map(p => transitions(p.levels));
  const seen = new Set(known);
  for (const split of ["train", "validation", "test"]) {
    for (const family of splitSpecs[split].families) {
      const p = TURNS_PATTERNS[family];
      assert.equal(p.levels.length, 8);
      assert.equal(p.levels[0], 2);
      const signature = transitions(p.levels);
      assert.equal(seen.has(signature), false, family + " repeats an existing directional schedule");
      seen.add(signature);
      // Check the actual sequence rather than counting the stratum labels alone.
      const directions = p.levels.slice(2).map((v, i) => Math.sign(v - p.levels[i + 1]))
        .filter(sign => sign).filter((sign, i, all) => sign !== all[i - 1]);
      assert.deepEqual(directions, p.stratum === "reversal" ? [1, -1] : [-1, 1, -1], family);
    }
  }
  assert.deepEqual(splitSpecs.test.families.map(f => TURNS_PATTERNS[f].stratum),
    ["reversal", "reversal", "interrupted-drop", "interrupted-drop"]);
  for (const [name, count] of Object.entries({ validation:128, test:1024, retention:256 })) {
    const cases = turnsCases(name), spec = splitSpecs[name];
    assert.equal(cases.length, count);
    assert.deepEqual(cases.slice(0,spec.families.length).map(row => row.family), spec.families);
    assert.equal(cases.at(-1).seed, spec.start + spec.count - 1);
  }
  const ordered = [...Object.values(DRIFT_SUITE.splits), ...Object.values(splitSpecs)].sort((a,b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i-1].start + ordered[i-1].count <= ordered[i].start);
  assert.throws(() => turnsCases("__proto__"), RangeError);
});

test("the same seed reproduces Drift prices, exogenous draws and delayed noisy surveys for each matched latent wave", () => {
  for (const seed of [0, 3, 47, 149, 0xffffffff]) {
    const originals = Object.keys(DRIFT_PATTERNS).map(family => createDrift({ seed, family }));
    for (const family of splitSpecs.test.families) {
      const s = createTurns({ seed, family });
      assert.deepEqual(observeTurns(s), observeDrift(originals[0]));
      for (let wave = 0; wave < 8; wave++) {
        const priceMatches = originals.filter(old => old.trueHighChances[wave] === s.trueHighChances[wave]);
        assert.ok(priceMatches.length, "At least one old path reaches the same state in each test wave.");
        for (const old of priceMatches) assert.deepEqual(s.offers[wave], old.offers[wave]);
        // Bulletin fixed at opening, then driven by the reading from waves 2 and 5.
        const surveyWave = wave < 3 ? null : wave < 6 ? 1 : 4;
        const quoteMatches = originals.filter(old =>
          surveyWave === null || old.trueHighChances[surveyWave] === s.trueHighChances[surveyWave]);
        assert.ok(quoteMatches.length);
        for (const old of quoteMatches) assert.deepEqual(s.board[wave], old.board[wave]);
      }
    }
  }
});

test("the participant sees a causal offer history and a common tape despite divergent bookings", () => {
  const a = createTurns({seed:3991, family:"late-crest"}), b = createTurns({seed:3991, family:"late-crest"});
  const history = [];
  while (!a.done) {
    const x = observeTurns(a), y = observeTurns(b);
    assert.deepEqual(Object.keys(x).sort(), ["capacity","done","forecast","history","horizon","net","offer","quote","slots","wave"]);
    for (const key of ["history","forecast","offer","quote"]) assert.deepEqual(x[key], y[key]);
    assert.deepEqual(x.history, history);
    for (const q of x.forecast) assert.equal(q.highChance,x.quote.highChance);
    history.push({wave:x.wave, offer:x.offer, quote:x.quote, high:x.quote.high === x.offer.net});
    stepTurns(a, x.slots ? "accept" : "pass");
    stepTurns(b, "pass");
  }
  assert.deepEqual(observeTurns(a).history, history);
  assert.equal(verifyTurns(b).net, 0);
  assert.equal(verifyTurns(a).accepted, 2);
  assert.deepEqual(verifyTurns(a).violations, []);
});

test("original interrupted-drop retention routes through the archived simulator and verifier", () => {
  assert.deepEqual(TURNS_PATTERNS["interrupted-drop"].levels, DRIFT_PATTERNS["interrupted-drop"].levels);
  for (const seed of [9400000,9400117,9400255]) {
    const config = {seed, family:"interrupted-drop"}, original = createDrift(config), guard = createTurns(config);
    assert.deepEqual(original, guard);
    while (!guard.done) {
      const action = [1,5].includes(guard.wave) ? "accept" : "pass";
      assert.deepEqual(stepTurns(guard, action), stepDrift(original, action));
    }
    assert.deepEqual(verifyTurns(guard), verifyDrift(original));
  }
});

test("fresh shift verifier reconstructs the signed tape, clock and capacity from calls", () => {
  const state = createTurns({ seed: 44, family: "early-rebound" });
  const first = observeTurns(state);
  first.offer.net = 999;
  first.forecast[0].highChance = 1;
  assert.notEqual(observeTurns(state).offer.net, 999);
  assert.notEqual(observeTurns(state).forecast[0].highChance, 1);
  stepTurns(state,"accept");
  stepTurns(state,"accept");
  assert.deepEqual(reserveCalls(observeTurns(state)).map(c=>c.id), ["pass"]);
  assert.throws(() => stepTurns(state,"accept"), RangeError);
  while (!state.done) stepTurns(state,"pass");
  for (const tamper of [
    s => s.net++, s => s.slots++, s => s.loads[0].lane = "Other",
    s => { s.loads[0].revenue++; s.offers[0].revenue++; s.net++; },
    s => s.calls[0].id = "pass", s => s.calls[7].wave = 1, s => s.done = false,
  ]) {
    const copy = structuredClone(state);
    tamper(copy);
    assert.ok(verifyTurns(copy).violations.length > 0);
  }
  assert.throws(() => createTurns({seed:0, family:"constructor"}), RangeError);
  assert.throws(() => createTurns({seed:-1}), RangeError);
});
