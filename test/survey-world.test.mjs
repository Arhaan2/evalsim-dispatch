import assert from "node:assert/strict";
import test from "node:test";
import { DRIFT_PATTERNS, DRIFT_SUITE, createDrift } from "../docs/lib/drift.js";
import { TURNS_PATTERNS, TURNS_SUITE } from "../docs/lib/turns.js";
import { CLOSES_PATTERNS, CLOSES_SUITE } from "../docs/lib/closes.js";
import { TRUST_PATTERNS, TRUST_SUITE } from "../docs/lib/trust.js";
import { RALLY_PATTERNS, RALLY_SUITE, createRally, verifyRally } from "../docs/lib/rally.js";
import { SURVEY_PATTERNS, SURVEY_SUITE, createSurvey, observeSurvey, stepSurvey, verifySurvey, surveyCases } from "../docs/lib/survey.js";

const { splits } = SURVEY_SUITE;
const prior = { ...DRIFT_PATTERNS, ...TURNS_PATTERNS, ...CLOSES_PATTERNS, ...TRUST_PATTERNS, ...RALLY_PATTERNS };
const signature = levels => levels.slice(1).map((x, w) => Math.sign(x - levels[w])).join("/");
const native = Object.entries(SURVEY_PATTERNS).filter(([name]) => !Object.hasOwn(prior, name));

test("survey schedules and learning banks hold out novel rises, falls and plateaus", () => {
  const signatures = new Set(Object.values(prior).map(p => signature(p.levels)));
  assert.equal(native.length, 60);
  for (const [name, { levels, stratum, ending, prefixLength }] of native) {
    assert.equal(levels.length, 8);
    assert.ok(levels.every(x => Number.isInteger(x) && x >= 0 && x <= 4));
    assert.equal(levels[0], 2);
    assert.ok(stratum === "reversal" ? levels[1] < 2 : levels[1] > 2);
    const prefix = levels.slice(0, prefixLength);
    const firstFall = prefix.findIndex((x, w) => w > 0 && x < prefix[w - 1]);
    assert.ok(firstFall >= 1 && prefix.slice(firstFall + 1).some((x, i) => x > prefix[firstFall + i]));
    assert.ok(ending === "cold" ? levels[6] <= 1 && levels[7] === 0 : levels[6] >= 3 && levels[7] === 4);
    assert.ok(!signatures.has(signature(levels)), name + " reuses a previous direction/timing pattern");
    signatures.add(signature(levels));
  }
  const earlier = [...Object.values(prior), ...splits.train.families.map(f => SURVEY_PATTERNS[f])];
  for (const split of ["validation", "test"]) {
    for (const name of splits[split].families) {
      const p = SURVEY_PATTERNS[name], opening = p.levels.slice(0, p.prefixLength);
      assert.ok(earlier.every(other => opening.some((x, i) => other.levels[i] !== x)), name);
    }
    earlier.push(...splits[split].families.map(f => SURVEY_PATTERNS[f]));
  }
  const banks = [DRIFT_SUITE, TURNS_SUITE, CLOSES_SUITE, TRUST_SUITE, RALLY_SUITE, SURVEY_SUITE]
    .flatMap(s => Object.values(s.splits)).sort((a, b) => a.start - b.start);
  for (let i = 1; i < banks.length; i++) assert.ok(banks[i - 1].start + banks[i - 1].count <= banks[i].start);
  assert.deepEqual(splits.train.families.filter(f => Object.hasOwn(prior, f)), ["brief-bounce", "held-bounce", "rounded-bounce"]);
  for (const f of splits.train.families.filter(f => Object.hasOwn(prior, f))) assert.ok(TURNS_SUITE.splits.train.families.includes(f));
  assert.deepEqual(splits.retention.families, ["interrupted-drop"]);
  assert.deepEqual(splits.archive.families, RALLY_SUITE.splits.test.families);
  assert.equal(splits.train.families.length, 51);
});

test("both strata cover aligned, reversed and neutral delayed readings; each case has matched draws", () => {
  for (const [split, count] of [["test", 8192], ["validation", 512], ["archive", 8192], ["retention", 1024]]) {
    const rows = surveyCases(split), bank = splits[split];
    assert.equal(rows.length, count);
    rows.forEach((row, i) => assert.deepEqual(row, {
      split, seed: bank.start + Math.floor(i / bank.families.length), family: bank.families[i % bank.families.length],
    }));
  }
  for (const split of ["train", "test"]) {
    for (const stratum of ["reversal", "interrupted-drop"]) {
      const subset = splits[split].families.map(f => SURVEY_PATTERNS[f]).filter(p => p.stratum === stratum && p.prefixLength);
      const cues = p => Math.sign(p.levels[4] - 2) * (p.ending === "hot" ? 1 : -1);
      assert.equal(subset.filter(p => p.ending === "hot").length, subset.length / 2);
      assert.deepEqual([...new Set(subset.map(cues))].sort(), [-1, 0, 1]);
      if (split === "train") {
        for (const ending of ["cold", "hot"]) assert.equal(new Set(subset.filter(p => p.ending === ending).map(p => p.levels[4])).size, 5);
      } else {
        const target = subset.filter(p => p.ending === (stratum === "reversal" ? "cold" : "hot"));
        assert.deepEqual(target.map(cues).sort(), [-1, 1]);
      }
    }
  }
  const priorPaths = RALLY_SUITE.splits.test.families;
  for (const [family, p] of native.filter(([, p]) => p.ending === "cold")) {
    const hot = p.stem + "-hot", twin = SURVEY_PATTERNS[hot];
    assert.equal(p.levels.findIndex((x, w) => x !== twin.levels[w]), p.prefixLength);
    // Fixture seeds are outside every study bank. Check only the public
    // generator plus ledgers; no reference or fitting code runs here.
    for (const seed of [3, 14, 89, 191, 0xffffffff]) {
      const a = createSurvey({ seed, family }), b = createSurvey({ seed, family: hot });
      while (!a.done) {
        const o = observeSurvey(a), twinView = observeSurvey(b), w = a.wave;
        if (w < p.prefixLength) assert.deepEqual(o, twinView);
        assert.deepEqual(Object.keys(o).sort(), ["capacity", "done", "forecast", "history", "horizon", "net", "offer", "quote", "slots", "wave"]);
        assert.equal(o.history.length, w);
        assert.ok(o.forecast.every(law => law.highChance === o.quote.highChance));
        if (p.levels[w] === twin.levels[w]) assert.equal(o.offer.net, twinView.offer.net);
        if (p.levels[w] < twin.levels[w]) assert.ok(o.offer.net <= twinView.offer.net);
        if (p.levels[w] > twin.levels[w]) assert.ok(o.offer.net >= twinView.offer.net);
        const source = w < 3 ? null : w < 6 ? 1 : 4;
        if (source === null || p.levels[source] === twin.levels[source]) assert.deepEqual(o.quote, twinView.quote);
        stepSurvey(a, "pass"); stepSurvey(b, "pass");
      }
      for (const reference of priorPaths) {
        const previous = createRally({ seed, family: reference }), levels = RALLY_PATTERNS[reference].levels;
        for (let w = 0; w < previous.board.length; w++) {
          assert.equal(a.board[w].high, previous.board[w].high);
          assert.equal(a.board[w].low, previous.board[w].low);
          if (p.levels[w] === levels[w]) assert.deepEqual(a.offers[w], previous.offers[w]);
          const source = w < 3 ? null : w < 6 ? 1 : 4;
          if (source === null || p.levels[source] === levels[source]) assert.deepEqual(a.board[w], previous.board[w]);
        }
      }
    }
  }
});

test("legacy shifts are exact and native score verification independently replays signed bookings", () => {
  for (const family of [...splits.archive.families, ...splits.retention.families, "brief-bounce"]) {
    const config = { family, seed: 971 }, s = createSurvey(config);
    assert.deepEqual(s, createRally(config));
    if (family === "interrupted-drop") assert.deepEqual(s, createDrift(config));
    while (!s.done) stepSurvey(s, s.wave === 2 || s.wave === 7 ? "accept" : "pass");
    assert.deepEqual(verifySurvey(s), verifyRally(s));
  }
  const s = createSurvey({ seed: 595 });
  while (!s.done) stepSurvey(s, s.wave === 2 || s.wave === 6 ? "accept" : "pass");
  assert.deepEqual(verifySurvey(s), { net: s.offers[2].net + s.offers[6].net, usedSlots: 2, accepted: 2, capacity: 2, waves: 8, violations: [] });
  for (const tamper of [a => a.wave++, a => a.slots++, a => a.calls[3].id = "skip", a => a.loads[1].wave++,
    a => { a.net++; a.offers[2].revenue++; a.loads[0].revenue++; }]) {
    const bad = structuredClone(s); tamper(bad); assert.ok(verifySurvey(bad).violations.length);
  }
  assert.throws(() => createSurvey({ family: "__proto__", seed: 0 }), RangeError);
  assert.throws(() => createSurvey({ seed: 2 ** 32 }), RangeError);
  assert.throws(() => surveyCases("constructor"), RangeError);
});
