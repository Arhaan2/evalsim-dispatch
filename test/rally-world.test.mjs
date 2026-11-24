import assert from "node:assert/strict";
import test from "node:test";
import { DRIFT_PATTERNS, DRIFT_SUITE, createDrift } from "../docs/lib/drift.js";
import { TURNS_PATTERNS, TURNS_SUITE } from "../docs/lib/turns.js";
import { CLOSES_PATTERNS, CLOSES_SUITE } from "../docs/lib/closes.js";
import { TRUST_PATTERNS, TRUST_SUITE, createTrust, verifyTrust } from "../docs/lib/trust.js";
import { RALLY_PATTERNS, RALLY_SUITE, createRally, observeRally, rallyCases, stepRally, verifyRally } from "../docs/lib/rally.js";

const { splits } = RALLY_SUITE;
const previous = { ...DRIFT_PATTERNS, ...TURNS_PATTERNS, ...CLOSES_PATTERNS, ...TRUST_PATTERNS };
const changes = p => p.levels.slice(1).map((level, i) => Math.sign(level - p.levels[i])).join(",");
const native = Object.entries(RALLY_PATTERNS).filter(([, p]) => p.prefixLength);

test("fresh schedules, seed banks and paired market weights are distinct from every earlier study", () => {
  const signatures = new Set(Object.values(previous).map(changes));
  for (const [family, p] of native) {
    assert.ok(!Object.hasOwn(previous, family));
    assert.ok(!signatures.has(changes(p)), family + " reuses a timing and direction schedule");
    signatures.add(changes(p));
    assert.equal(p.levels.length, 8);
    assert.equal(p.levels[0], 2);
    assert.ok(p.levels.every(v => Number.isInteger(v) && v >= 0 && v <= 4));
    assert.ok(p.stratum === "reversal" ? p.levels[1] < 2 : p.levels[1] > 2);
    const opening = p.levels.slice(0, p.prefixLength);
    // The common rally follows the first drop. The initial up-move in an
    // interrupted drop is not sufficient to qualify an opening as a rally.
    const dip = opening.findIndex((v, i) => i > 0 && v < opening[i - 1]);
    assert.ok(dip > 0 && opening.slice(dip + 1).some((v, i) => v > opening[dip + i]), family);
    assert.equal(p.levels[7], p.ending === "hot" ? 4 : 0);
    assert.ok(p.ending === "hot" ? p.levels[6] >= 3 : p.levels[6] <= 1);
  }
  const earlier = [...Object.values(previous), ...[...splits.train.families, ...splits.validation.families].map(f => RALLY_PATTERNS[f])];
  for (const family of splits.test.families) {
    const p = RALLY_PATTERNS[family];
    const opening = p.levels.slice(0, p.prefixLength);
    assert.ok(earlier.every(q => opening.some((v, i) => v !== q.levels[i])), family + " has a previously sampled opening");
  }
  assert.deepEqual(splits.train.families.filter(f => Object.hasOwn(previous, f)),
    ["brief-bounce", "held-bounce", "rounded-bounce"]);
  for (const f of splits.train.families.filter(f => Object.hasOwn(previous, f))) assert.ok(TURNS_SUITE.splits.train.families.includes(f));
  assert.deepEqual(splits.retention.families, ["interrupted-drop"]);
  assert.deepEqual(splits.archive.families, TRUST_SUITE.splits.test.families);
  const families = Object.values(splits).flatMap(s => s.families);
  assert.equal(new Set(families).size, families.length);
  const banks = [DRIFT_SUITE, TURNS_SUITE, CLOSES_SUITE, TRUST_SUITE, RALLY_SUITE]
    .flatMap(s => Object.values(s.splits)).sort((a, b) => a.start - b.start);
  for (let i = 1; i < banks.length; i++) assert.ok(banks[i-1].start + banks[i-1].count <= banks[i].start);
  for (const [name, count] of [["validation", 512], ["test", 8192], ["retention", 1024], ["archive", 8192]]) {
    const rows = rallyCases(name), spec = splits[name];
    assert.equal(rows.length, count);
    for (const [i, row] of rows.entries()) assert.deepEqual(row, {
      split: name, family: spec.families[i % spec.families.length], seed: spec.start + Math.floor(i / spec.families.length),
    });
    if (name === "retention") continue;
    for (const stratum of ["reversal", "interrupted-drop"])
      for (const ending of ["cold", "hot"])
        assert.equal(rows.filter(r => RALLY_PATTERNS[r.family].stratum === stratum && RALLY_PATTERNS[r.family].ending === ending).length, count / 4);
  }
});

test("matched openings share their signed tape and the clock cannot identify the ending", () => {
  for (const [family, p] of native.filter(([, p]) => p.ending === "cold")) {
    const twin = p.stem + "-hot";
    const hotPath = RALLY_PATTERNS[twin].levels;
    assert.equal(p.levels.findIndex((v, i) => v !== hotPath[i]), p.prefixLength);
    assert.ok(p.prefixLength >= 3 && p.prefixLength <= 5);
    // Both twins can sign an identical or a differing first post-fork offer.
    // This uses fixture seeds outside all study banks and scores no policy.
    const forkOutcomes = new Set();
    for (let seed = 0; seed < 64; seed++) {
      const cold = createRally({ family, seed }), hot = createRally({ family: twin, seed });
      const observations = [observeRally(cold), observeRally(hot)];
      while (!cold.done) {
        const wave = cold.wave, [a,b] = observations;
        if (wave < p.prefixLength) assert.deepEqual(a, b);
        if (wave === p.prefixLength) forkOutcomes.add(a.offer.net === b.offer.net);
        for (const o of observations) {
          assert.deepEqual(Object.keys(o).sort(), ["capacity","done","forecast","history","horizon","net","offer","quote","slots","wave"]);
          assert.equal(o.history.length, wave);
          assert.ok(o.forecast.every(quote => quote.highChance === o.quote.highChance));
        }
        const ca = cold.trueHighChances[wave], cb = hot.trueHighChances[wave];
        if (ca === cb) assert.equal(a.offer.net, b.offer.net);
        if (ca < cb) assert.ok(a.offer.net <= b.offer.net);
        if (ca > cb) assert.ok(a.offer.net >= b.offer.net);
        if (wave < 6 || p.levels[4] === hotPath[4]) assert.deepEqual(a.quote, b.quote);
        observations[0] = stepRally(cold, "pass");
        observations[1] = stepRally(hot, "pass");
      }
    }
    assert.equal(forkOutcomes.size, 2);
  }
});

test("historical checks reproduce the exact generator and the unchanged noisy public survey", () => {
  for (const [family, p] of Object.entries(RALLY_PATTERNS)) {
    for (const seed of [0, 39, 1071, 0xffffffff]) {
      const info = {seed, family}, state = createRally(info);
      if (!p.prefixLength) {
        assert.deepEqual(state, createTrust(info));
        if (family === "interrupted-drop") assert.deepEqual(state, createDrift(info));
        while (!state.done) stepRally(state, state.wave === 4 ? "accept" : "pass");
        assert.deepEqual(verifyRally(state), verifyTrust(state));
      } else {
        for (const name of TRUST_SUITE.splits.test.families) {
          const prior = createTrust({seed, family: name}), levels = TRUST_PATTERNS[name].levels;
          for (let wave = 0; wave < state.board.length; wave++) {
            assert.equal(state.board[wave].low, prior.board[wave].low);
            assert.equal(state.board[wave].high, prior.board[wave].high);
            if (levels[wave] === p.levels[wave]) {
              assert.equal(state.trueHighChances[wave], prior.trueHighChances[wave]);
              assert.deepEqual(state.offers[wave], prior.offers[wave]);
            }
            const surveyWave = wave < 3 ? null : wave < 6 ? 1 : 4;
            if (surveyWave === null || p.levels[surveyWave] === levels[surveyWave]) assert.deepEqual(state.board[wave], prior.board[wave]);
          }
        }
      }
    }
  }
});

test("public offers are independent of bookings and the verifier rebuilds the signed ledger", () => {
  for (const family of splits.test.families) {
    const cfg = { family, seed: 79 }, booked = createRally(cfg), idle = createRally(cfg);
    const obs = observeRally(booked);
    obs.offer.net = 101; obs.quote.highChance = 1; obs.forecast[2].low = -9;
    assert.deepEqual(observeRally(booked), observeRally(idle));
    while (!booked.done) {
      const a = observeRally(booked), b = observeRally(idle);
      for (const key of ["offer", "quote", "history", "forecast"]) assert.deepEqual(a[key], b[key]);
      stepRally(booked, booked.wave === 1 || booked.wave === 4 ? "accept" : "pass"); stepRally(idle, "pass");
    }
    assert.deepEqual(verifyRally(booked), { net: booked.offers[1].net + booked.offers[4].net, accepted: 2,
      usedSlots: 2, capacity: 2, waves: 8, violations: [] });
    for (const tamper of [
      s => { s.loads[0].revenue++; s.offers[1].revenue++; s.net++; }, s => s.slots++, s => s.loads[1].lane = "Elsewhere",
      s => s.calls[1].wave++, s => s.calls[1].id = "reject", s => s.done = false,
    ]) {
      const bad = structuredClone(booked); tamper(bad); assert.ok(verifyRally(bad).violations.length);
    }
  }
  assert.throws(() => createRally({family: "__proto__", seed: 0}), RangeError);
  assert.throws(() => createRally({seed: -1}), RangeError);
  assert.throws(() => rallyCases("constructor"), RangeError);
});
