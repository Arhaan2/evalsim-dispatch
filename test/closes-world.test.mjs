import assert from "node:assert/strict";
import test from "node:test";
import { CLOSES_PATTERNS, CLOSES_SUITE, closesCases, createCloses, observeCloses, stepCloses, verifyCloses } from "../docs/lib/closes.js";
import { createDrift, DRIFT_PATTERNS, DRIFT_SUITE } from "../docs/lib/drift.js";
import { createTurns, observeTurns, stepTurns, TURNS_PATTERNS, TURNS_SUITE, verifyTurns } from "../docs/lib/turns.js";

const freshSplits = ["train", "validation", "test"];
const splits = CLOSES_SUITE.splits;
function directions(levels) {
  return levels.slice(1).map((value, i) => Math.sign(value - levels[i]));
}
function familiesWithColdEnds(split) {
  return split.families.filter(family => CLOSES_PATTERNS[family].ending === "cold");
}

test("balanced paired endings, distinct timing profiles and disjoint seed banks", () => {
  const timing = new Set(Object.values({...DRIFT_PATTERNS, ...TURNS_PATTERNS})
    .map(p => directions(p.levels).join(",")));
  for (const split of freshSplits) {
    const spec = splits[split], stems = familiesWithColdEnds(spec);
    assert.equal(spec.families.length, stems.length * 2);
    assert.equal(stems.filter(family => CLOSES_PATTERNS[family].stratum === "reversal").length, stems.length / 2);
    for (const family of stems) {
      const cold = CLOSES_PATTERNS[family], hot = CLOSES_PATTERNS[cold.stem + "-hot"];
      assert.ok(spec.families.includes(cold.stem + "-hot"));
      assert.equal(cold.stratum, hot.stratum);
      assert.equal(cold.stem, hot.stem);
      const fork = cold.levels.findIndex((level, i) => level !== hot.levels[i]);
      assert.ok(fork === 4 || fork === 5, "Both endings become possible to distinguish by wave six.");
      for (const [pattern, last] of [[cold, 0], [hot, 4]]) {
        assert.equal(pattern.levels.length, 8);
        assert.equal(pattern.levels[0], 2);
        assert.deepEqual(pattern.levels.slice(-2), [last, last]);
        const movements = directions(pattern.levels);
        assert.ok(!timing.has(movements.join(",")), family + " duplicates an earlier change schedule");
        timing.add(movements.join(","));
        const signs = movements.slice(1, 5).filter(sign => sign !== 0)
          .filter((sign, i, all) => sign !== all[i - 1]);
        if (pattern.stratum === "reversal") {
          assert.ok(pattern.levels[1] < 2);
          assert.deepEqual(signs.slice(0, 2), [1, -1]);
        } else {
          assert.ok(pattern.levels[1] > 2);
          assert.deepEqual(signs.slice(0, 3), [-1, 1, -1]);
        }
      }
    }
  }
  for (const [name, size] of [["validation", 512], ["test", 4096], ["retention", 1536]]) {
    const cases = closesCases(name), spec = splits[name];
    assert.equal(cases.length, size);
    for (let i = 0; i < spec.count; i++) {
      const rows = cases.slice(i * spec.families.length, (i + 1) * spec.families.length);
      assert.deepEqual(rows.map(row => row.family), spec.families);
      assert.ok(rows.every(row => row.seed === spec.start + i && row.split === name));
    }
  }
  const banks = [...Object.values(DRIFT_SUITE.splits), ...Object.values(TURNS_SUITE.splits), ...Object.values(splits)]
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < banks.length; i++) assert.ok(banks[i-1].start + banks[i-1].count <= banks[i].start);
  assert.throws(() => closesCases("toString"), RangeError);
});

test("each twin shares the signed prefix, price schedule and lagged survey stream", () => {
  for (const split of freshSplits) {
    for (const family of familiesWithColdEnds(splits[split])) {
      const pattern = CLOSES_PATTERNS[family], hotFamily = pattern.stem + "-hot";
      const fork = pattern.levels.findIndex((n, i) => n !== CLOSES_PATTERNS[hotFamily].levels[i]);
      for (const seed of [0, 41, 82, 4321, 0xffffffff]) {
        const a = createCloses({seed, family}), b = createCloses({seed, family: hotFamily});
        assert.deepEqual(a, createCloses({seed, family}));
        const archived = createDrift({seed, family: "step-up"});
        assert.deepEqual(observeCloses(a), observeTurns(archived));
        while (!a.done) {
          const x = observeCloses(a), y = observeCloses(b), w = x.wave;
          if (w < fork) assert.deepEqual(x, y);
          assert.deepEqual([x.quote.low, x.quote.high, x.offer.lane, x.offer.cost],
            [archived.board[w].low, archived.board[w].high, archived.offers[w].lane, archived.offers[w].cost]);
          assert.deepEqual([x.quote.low, x.quote.high], [y.quote.low, y.quote.high]);
          if (a.trueHighChances[w] === b.trueHighChances[w]) assert.deepEqual(x.offer, y.offer);
          // A change in the branch cannot affect a published survey until
          // its reading (wave two or five) reflects a different probability.
          const surveyWave = w < 3 ? null : w < 6 ? 1 : 4;
          if (surveyWave === null || a.trueHighChances[surveyWave] === b.trueHighChances[surveyWave])
            assert.deepEqual(x.quote, y.quote);
          assert.deepEqual(Object.keys(x).sort(), ["capacity","done","forecast","history","horizon","net","offer","quote","slots","wave"]);
          assert.ok(x.forecast.every(quote => quote.highChance === x.quote.highChance));
          assert.equal(x.history.length, w);
          stepCloses(a, "pass"); stepCloses(b, "pass");
        }
        assert.ok(a.trueHighChances[7] <= 0.20 && b.trueHighChances[7] >= 0.75);
      }
    }
  }
});

test("every historical interrupted-drop guard runs through its exact released generator and verifier", () => {
  assert.deepEqual(splits.retention.families, ["early-rebound", "late-rebound", "interrupted-drop"]);
  for (const family of splits.retention.families) {
    for (const seed of [0, 10400000, 10400319, 10400511]) {
      const cfg = {seed, family}, archived = createTurns(cfg), guard = createCloses(cfg);
      assert.deepEqual(archived, guard);
      if (family === "interrupted-drop") assert.deepEqual(guard, createDrift(cfg));
      while (!guard.done) {
        const action = [2, 4].includes(guard.wave) ? "accept" : "pass";
        assert.deepEqual(stepCloses(guard, action), stepTurns(archived, action));
      }
      assert.deepEqual(verifyCloses(guard), verifyTurns(archived));
      assert.deepEqual(verifyCloses(guard).violations, []);
    }
  }
});

test("bookings cannot alter demand, and the ledger regenerates the signed freight", () => {
  for (const family of splits.test.families) {
    const cfg = {seed: 1001, family}, books = createCloses(cfg), waits = createCloses(cfg);
    const observation = observeCloses(books);
    observation.forecast[0].highChance = -1;
    observation.offer.net = 900;
    assert.deepEqual(observeCloses(books), observeCloses(waits));
    while (!books.done) {
      const a = observeCloses(books), b = observeCloses(waits);
      for (const key of ["offer", "history", "quote", "forecast"]) assert.deepEqual(a[key], b[key]);
      stepCloses(books, a.wave === 2 || a.wave === 6 ? "accept" : "pass");
      stepCloses(waits, "pass");
    }
    const expected = books.offers[2].net + books.offers[6].net;
    assert.deepEqual(verifyCloses(books), { net:expected, accepted:2, usedSlots:2, capacity:2, waves:8, violations:[] });
    assert.equal(verifyCloses(waits).net, 0);
    for (const change of [
      s => { s.offers[2].revenue++; s.loads[0].revenue++; s.net++; },
      s => s.loads[1].lane = "Other", s => s.slots++, s => s.net++,
      s => s.calls[1].wave = 0, s => s.calls[1].id = "accept", s => s.done = false,
    ]) {
      const copy = structuredClone(books); change(copy);
      assert.ok(verifyCloses(copy).violations.length);
    }
  }
  assert.throws(() => createCloses({seed: 0, family: "__proto__"}), RangeError);
  assert.throws(() => createCloses({seed: -1}), RangeError);
});
