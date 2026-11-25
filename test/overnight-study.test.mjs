import assert from "node:assert/strict";
import test from "node:test";
import { FLEET_PATTERNS, FLEET_FAMILIES } from "../docs/lib/fleetweek.js";
import { fleetCases } from "../docs/lib/fleetweek-study.js";
import { OVERNIGHT_PATTERNS } from "../docs/lib/overnight-markets.js";
import { OVERNIGHT_FAMILIES, OVERNIGHT_SPLITS, overnightCases, summarizeOvernight } from "../docs/lib/overnight-study.js";

function canonical(schedule) {
  const labels = [...new Set(schedule)];
  return [...schedule].map(x => labels.indexOf(x)).join("");
}

test("overnight markets reserve distinct schedule shapes and independent weeks", () => {
  const names = Object.values(FLEET_FAMILIES).flat();
  assert.deepEqual(names.slice(-4), ["friday-switch", "split-week", "midweek-pivot", "double-return"]);
  assert.deepEqual(Object.keys(FLEET_PATTERNS).sort(), [...names].sort());
  const schedules = [...Object.values(FLEET_PATTERNS), ...Object.values(OVERNIGHT_PATTERNS)];
  for (const shape of schedules) assert.match(shape, /^[012]{10}$/);
  assert.equal(new Set(schedules.map(canonical)).size, schedules.length);
  const freshReturns = OVERNIGHT_FAMILIES.test.slice(0, 2);
  for (const name of [...freshReturns, "double-return"]) {
    const pattern = OVERNIGHT_PATTERNS[name] ?? FLEET_PATTERNS[name];
    const phases = pattern.replace(/(.)\1+/g, "$1");
    assert.equal(canonical(phases), "01020");
  }
  assert.deepEqual(OVERNIGHT_FAMILIES.archive, ["double-return"]);
  const banks = OVERNIGHT_SPLITS.map(overnightCases);
  assert.deepEqual(banks.map(rows=>rows.length), [256, 2048, 1024]);
  const previous = [...fleetCases("test"), ...fleetCases("validation")].map(c => c.seed);
  const all = [...previous, ...banks.flat().map(c => c.seed)];
  assert.equal(new Set(all).size, all.length);
  assert.throws(()=>overnightCases("constructor"));
});

function ledger(net, served) {
  return {net, gross:net + 34 * (10 - served), loadedCost:0, emptyCost:0,
    penalty:34 * (10 - served), served, contracts:10, emptyMiles:0};
}

test("earnings and service gates use paired uncertainty and zero service tolerance", () => {
  const make = (net, served) => {
    const ref = ledger(7, 6), agent = ledger(net, served);
    return {family:"fixture", agent, rl:agent, planner:ref, greedy:ref, previous:ref, noEmpty:ref};
  };
  const fixture = [make(8,6), make(9,6)];
  const exact = summarizeOvernight(fixture);
  assert.equal(exact.all.earnsMoreThanPlanner, true);
  assert.equal(exact.all.matchesPlannerService, true);
  assert.equal(exact.all.beatsPlanner, true);
  assert.deepEqual(exact.all,exact.byFamily.fixture);
  const uncertain = summarizeOvernight([make(8,5),make(8,7)]).all;
  assert.equal(uncertain.comparisons.planner.servicePP, 0);
  assert(uncertain.comparisons.planner.service95[0] < 0);
  assert.equal(uncertain.beatsPlanner, false);
  assert.equal(uncertain.earnsMoreThanPlanner,true);
  assert.equal(summarizeOvernight([make(7,7)]).all.earnsMoreThanPlanner, false);
  assert.throws(()=>summarizeOvernight([]));
});
