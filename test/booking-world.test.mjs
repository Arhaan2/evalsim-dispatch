import assert from "node:assert/strict";
import test from "node:test";
import { DRIFT_PATTERNS, DRIFT_SUITE, createDrift } from "../docs/lib/drift.js";
import { TURNS_PATTERNS, TURNS_SUITE } from "../docs/lib/turns.js";
import { CLOSES_PATTERNS, CLOSES_SUITE } from "../docs/lib/closes.js";
import { TRUST_PATTERNS, TRUST_SUITE } from "../docs/lib/trust.js";
import { RALLY_PATTERNS, RALLY_SUITE } from "../docs/lib/rally.js";
import { SURVEY_PATTERNS, SURVEY_SUITE, createSurvey, stochasticPlanner as previousPlanner } from "../docs/lib/survey.js";
import { BOOKING_PATTERNS, BOOKING_SUITE, bookingCases, createBooking, observeBooking, verifyBooking, stepBooking, stochasticPlanner } from "../docs/lib/booking.js";

const { splits } = BOOKING_SUITE;
const prior = { ...DRIFT_PATTERNS, ...TURNS_PATTERNS, ...CLOSES_PATTERNS, ...TRUST_PATTERNS, ...RALLY_PATTERNS, ...SURVEY_PATTERNS };
const shape = path => path.slice(1).map((v,i) => Math.sign(v-path[i])).join("/");
const pairsIn = names => names.map(f => BOOKING_PATTERNS[f]).filter(p => p.prefixLength && p.ending === "cold");

test("every new schedule has a distinct timing signature and fresh forks begin on previously unseen openings", () => {
  const earlier = Object.values(prior).map(p => p.levels);
  const signatures = new Set(earlier.map(shape));
  for (const split of ["train", "validation", "test"]) {
    const current = splits[split].families.map(f => BOOKING_PATTERNS[f]);
    for (const p of current) {
      assert.equal(p.levels.length,8);
      assert.equal(p.levels[0],2);
      assert.ok(p.levels.every(v => Number.isInteger(v) && v >= 0 && v <= 4));
      assert.ok(p.stratum === "reversal" ? p.levels[1] < 2 : p.levels[1] > 2);
      assert.ok(p.ending === "hot" ? p.levels[6] >= 3 && p.levels[7] === 4 : p.levels[6] <= 1 && p.levels[7] === 0);
      const timing = shape(p.levels);
      assert.ok(!signatures.has(timing),p.label + " reuses an existing timing signature");
      signatures.add(timing);
      if (split !== "train") {
        const opening = p.levels.slice(0,p.prefixLength);
        assert.ok(earlier.every(path => opening.some((v,i) => v !== path[i])),p.label);
      }
    }
    earlier.push(...current.map(p => p.levels));
  }
  for (const [name,strata] of [["train",12],["validation",1],["test",2]]) {
    const cold = pairsIn(splits[name].families);
    for (const stratum of ["reversal","interrupted-drop"]) {
      const group = cold.filter(p => p.stratum === stratum);
      assert.equal(group.length,strata);
      for (const p of group) {
        const twin = BOOKING_PATTERNS[p.stem + "-hot"];
        assert.equal(p.levels.findIndex((v,i) => v !== twin.levels[i]),p.prefixLength);
        assert.equal(twin.stratum,p.stratum);
      }
      if (name === "test") {
        assert.deepEqual(group.map(p => p.prefixLength).sort(),[4,5]);
        const targets = stratum === "reversal" ? group : group.map(p => BOOKING_PATTERNS[p.stem+"-hot"]);
        // The wave-seven survey measures wave five. For each target stratum
        // one latent fifth-wave level is warm and one is cool.
        assert.deepEqual(targets.map(p => Math.sign(p.levels[4]-2)).sort(),[-1,1]);
      }
    }
  }
  const analogues = splits.train.families.filter(f => !BOOKING_PATTERNS[f].prefixLength);
  assert.equal(analogues.length,9);
  for (const f of analogues) {
    const p = BOOKING_PATTERNS[f];
    assert.ok(!prior[f]);
    assert.equal(p.stratum,"interrupted-drop");
    assert.equal(p.ending,"cold");
    assert.ok(p.levels.slice(0,6).filter((v,i) => v !== DRIFT_PATTERNS["interrupted-drop"].levels[i]).length >= 2);
  }
  assert.equal(splits.train.families.length,57);
});

test("new banks are disjoint and historical splits use the unchanged generators", () => {
  const suites = [DRIFT_SUITE,TURNS_SUITE,CLOSES_SUITE,TRUST_SUITE,RALLY_SUITE,SURVEY_SUITE,BOOKING_SUITE];
  const banks = suites.flatMap(s => Object.values(s.splits)).sort((a,b) => a.start-b.start);
  for (let i=1; i<banks.length; i++) assert.ok(banks[i-1].start+banks[i-1].count <= banks[i].start);
  assert.deepEqual(splits.archive.families,SURVEY_SUITE.splits.test.families);
  assert.deepEqual(splits.retention.families,["interrupted-drop"]);
  const ids = Object.values(splits).flatMap(s => s.families);
  assert.equal(new Set(ids).size,ids.length);
  for (const [name,expected] of [["validation",512],["test",8192],["archive",8192],["retention",1024]]) {
    const bank = splits[name], rows = bookingCases(name);
    assert.equal(rows.length,expected);
    rows.forEach((r,i) => assert.deepEqual(r, { split:name, seed:bank.start+Math.floor(i/bank.families.length), family:bank.families[i%bank.families.length] }));
  }
  for (const family of [...splits.archive.families, ...splits.retention.families]) {
    const config={seed:1979,family};
    assert.deepEqual(createBooking(config),createSurvey(config));
    if (family === "interrupted-drop") assert.deepEqual(createBooking(config),createDrift(config));
  }
  assert.equal(stochasticPlanner,previousPlanner);
  assert.throws(() => createBooking({family:"__proto__",seed:0}),RangeError);
  assert.throws(() => createBooking({seed:-1}),RangeError);
  assert.throws(() => bookingCases("constructor"),RangeError);
});

test("twins share early public observations and random draws, independent of the booking actions", () => {
  const publicFields = ["capacity","done","forecast","history","horizon","net","offer","quote","slots","wave"];
  for (const p of pairsIn([...splits.train.families,...splits.validation.families,...splits.test.families])) {
    const twin = BOOKING_PATTERNS[p.stem+"-hot"];
    // Fixture seeds outside all study banks. Exercise the world without running a policy.
    for (const seed of [39,172,0xffffffff]) {
      const a = createBooking({seed,family:p.stem+"-cold"}), b = createBooking({seed,family:p.stem+"-hot"});
      const booked = createBooking({seed,family:p.stem+"-cold"});
      while (!a.done) {
        const o=observeBooking(a), alt=observeBooking(b), used=observeBooking(booked), w=a.wave;
        assert.deepEqual(Object.keys(o).sort(),publicFields);
        assert.equal(o.history.length,w);
        assert.ok(o.forecast.every(q => q.highChance === o.quote.highChance));
        for (const field of ["offer","quote","history","forecast"]) assert.deepEqual(used[field],o[field]);
        if (w<p.prefixLength) assert.deepEqual(o,alt);
        if (p.levels[w] <= twin.levels[w]) assert.ok(o.offer.net <= alt.offer.net);
        if (p.levels[w] >= twin.levels[w]) assert.ok(o.offer.net >= alt.offer.net);
        const source=w<3 ? null : w<6 ? 1 : 4;
        if (source===null || p.levels[source]===twin.levels[source]) assert.deepEqual(o.quote,alt.quote);
        stepBooking(a,"pass");
        stepBooking(b,"pass");
        stepBooking(booked,w===0 || w===2 ? "accept" : "pass");
      }
      const ledger = verifyBooking(booked);
      assert.equal(ledger.net,booked.offers[0].net+booked.offers[2].net);
      assert.deepEqual(ledger.violations,[]);
      const bad=structuredClone(booked);
      bad.offers[0].revenue++; bad.loads[0].revenue++; bad.net++;
      assert.ok(verifyBooking(bad).violations.length);
    }
  }
});
