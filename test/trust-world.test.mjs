import assert from "node:assert/strict";
import test from "node:test";
import { CLOSES_PATTERNS, CLOSES_SUITE, createCloses, verifyCloses } from "../docs/lib/closes.js";
import { DRIFT_PATTERNS, DRIFT_SUITE, createDrift } from "../docs/lib/drift.js";
import { TURNS_PATTERNS, TURNS_SUITE, createTurns, verifyTurns } from "../docs/lib/turns.js";
import { TRUST_PATTERNS, TRUST_SUITE, createTrust, observeTrust, stepTrust, trustCases, verifyTrust } from "../docs/lib/trust.js";

const { splits } = TRUST_SUITE;
const previous = { ...DRIFT_PATTERNS, ...TURNS_PATTERNS, ...CLOSES_PATTERNS };
const directions = levels => levels.slice(1).map((p, i) => Math.sign(p - levels[i]));

test("router training excludes archived evaluations; each fresh path has a new change schedule", () => {
  const allowed = new Set([...CLOSES_SUITE.splits.train.families, ...TURNS_SUITE.splits.train.families]);
  assert.equal(splits.train.families.length, 19);
  for (const f of splits.train.families) assert.ok(!Object.hasOwn(previous, f) || allowed.has(f), f);
  const seen = new Set(Object.values(previous).map(p => directions(p.levels).join(",")));
  for (const split of ["train", "validation", "test"]) {
    for (const f of splits[split].families) {
      if (split === "train" && allowed.has(f)) continue;
      const p = TRUST_PATTERNS[f], signature = directions(p.levels).join(",");
      assert.equal(p.levels.length, 8);
      assert.equal(p.levels[0], 2);
      assert.equal(p.levels[7], p.ending === "hot" ? 4 : 0);
      assert.ok(p.ending === "hot" ? p.levels[6] >= 3 : p.levels[6] <= 1);
      assert.ok(p.stratum === "reversal" ? p.levels[1] < 2 : p.levels[1] > 2);
      const moves = directions(p.levels).slice(1, 5).filter(x => x !== 0)
        .filter((x, i, arr) => x !== arr[i - 1]);
      if (p.stratum === "interrupted-drop") assert.deepEqual(moves.slice(0, 3), [-1, 1, -1]);
      else assert.deepEqual(moves.slice(0, 2), [1, -1]);
      assert.ok(!seen.has(signature), f + " repeats a previously used timing");
      seen.add(signature);
    }
  }
  const familyNames = Object.values(splits).flatMap(s => s.families);
  assert.equal(new Set(familyNames).size, familyNames.length);
  for (const [name, n] of [["validation", 512], ["test", 8192], ["retention", 1024], ["archive", 8192]]) {
    const rows = trustCases(name), spec = splits[name];
    assert.equal(rows.length, n);
    for (const [i, row] of rows.entries()) {
      assert.deepEqual(row, { split: name, seed: spec.start + Math.floor(i / spec.families.length),
        family: spec.families[i % spec.families.length] });
    }
    if (name === "retention") continue;
    for (const stratum of ["interrupted-drop", "reversal"]) {
      const selected = rows.filter(r => TRUST_PATTERNS[r.family].stratum === stratum);
      for (const ending of ["hot", "cold"]) {
        assert.equal(selected.filter(r => TRUST_PATTERNS[r.family].ending === ending).length, n / 4);
      }
    }
  }
  const banks = [DRIFT_SUITE, TURNS_SUITE, CLOSES_SUITE, TRUST_SUITE].flatMap(s => Object.values(s.splits))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < banks.length; i++) assert.ok(banks[i-1].start + banks[i-1].count <= banks[i].start);
});

test("paired openings share observations and repeat the earlier random tape at equal demand", () => {
  for (const [family, p] of Object.entries(TRUST_PATTERNS)) {
    if (Object.hasOwn(previous, family) || p.ending !== "cold") continue;
    const hot = p.stem + "-hot";
    const fork = p.levels.findIndex((v, i) => v !== TRUST_PATTERNS[hot].levels[i]);
    assert.ok(fork === 4 || fork === 5);
    for (const seed of [0, 241, 3125, 11300000, 0xffffffff]) {
      const coldState = createTrust({ seed, family }), hotState = createTrust({ seed, family: hot });
      const archived = Object.entries(CLOSES_PATTERNS).map(([f, info]) => ({ info, s: createCloses({seed, family:f}) }));
      while (!coldState.done) {
        const wave = coldState.wave, a = observeTrust(coldState), b = observeTrust(hotState);
        if (wave < fork) assert.deepEqual(a, b);
        assert.deepEqual(Object.keys(a).sort(), ["capacity","done","forecast","history","horizon","net","offer","quote","slots","wave"]);
        assert.equal(a.history.length, wave);
        assert.ok(a.forecast.every(quote => quote.highChance === a.quote.highChance));
        for (const [state, level] of [[coldState, p.levels], [hotState, TRUST_PATTERNS[hot].levels]]) {
          // Price draws use a shared tape. Every old pattern with the same
          // probability at this wave must sign the same load.
          for (const {info, s} of archived) {
            if (info.levels[wave] === level[wave]) {
              assert.equal(state.trueHighChances[wave], s.trueHighChances[wave]);
              assert.deepEqual(state.offers[wave], s.offers[wave]);
            }
            const survey = wave < 3 ? null : wave < 6 ? 1 : 4;
            if (survey === null || level[survey] === info.levels[survey]) assert.deepEqual(state.board[wave], s.board[wave]);
          }
        }
        stepTrust(coldState, "pass"); stepTrust(hotState, "pass");
      }
    }
  }
});

test("historical routes use the versioned generator, on newly reserved market seeds", () => {
  assert.deepEqual(splits.archive.families, CLOSES_SUITE.splits.test.families);
  assert.deepEqual(splits.retention.families, ["interrupted-drop"]);
  for (const [name, spec] of Object.entries(splits)) {
    for (const family of spec.families.filter(f => Object.hasOwn(previous, f))) {
      for (const seed of [spec.start, spec.start + spec.count - 1]) {
        const cfg = {seed, family}, s = createTrust(cfg);
        const archived = Object.hasOwn(CLOSES_PATTERNS, family) ? createCloses(cfg) : createTurns(cfg);
        assert.deepEqual(s, archived);
        if (name === "retention") assert.deepEqual(s, createDrift(cfg));
        while (!s.done) stepTrust(s, s.wave === 3 || s.wave === 6 ? "accept" : "pass");
        const oldVerify = Object.hasOwn(CLOSES_PATTERNS, family) ? verifyCloses : verifyTurns;
        assert.deepEqual(verifyTrust(s), oldVerify(s));
        assert.deepEqual(verifyTrust(s).violations, []);
      }
    }
  }
});

test("fresh shift offers remain exogenous and the ledger independently rebuilds signed prices", () => {
  for (const family of splits.test.families) {
    const cfg = {seed: 42, family}, s = createTrust(cfg), never = createTrust(cfg);
    const o = observeTrust(s); o.offer.net = 10001; o.forecast[1].highChance = -1;
    assert.deepEqual(observeTrust(s), observeTrust(never));
    while (!s.done) {
      const o = observeTrust(s), other = observeTrust(never);
      for (const k of ["offer","quote","history","forecast"]) assert.deepEqual(o[k], other[k]);
      stepTrust(s, s.wave === 2 || s.wave === 6 ? "accept" : "pass");
      stepTrust(never, "pass");
    }
    assert.deepEqual(verifyTrust(s), { net: s.offers[2].net + s.offers[6].net, accepted: 2, usedSlots: 2, capacity: 2, waves: 8, violations: [] });
    for (const tamper of [
      x => { x.loads[0].revenue++; x.offers[2].revenue++; x.net++; }, x => x.loads[0].lane = "elsewhere",
      x => x.slots++, x => x.calls[2].id = "pass", x => x.calls[0].wave++, x => x.done = false,
    ]) { const bad = structuredClone(s); tamper(bad); assert.ok(verifyTrust(bad).violations.length); }
  }
  assert.throws(() => trustCases("__proto__"), RangeError);
  assert.throws(() => createTrust({family: "toString", seed: 7}), RangeError);
  assert.throws(() => createTrust({seed: -1}), RangeError);
});
