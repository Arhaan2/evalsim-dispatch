import assert from "node:assert/strict";
import test from "node:test";
import {FLEET_PATTERNS, FLEET_FAMILIES, runFleetWeek} from "../docs/lib/fleetweek.js";
import {fleetCases, fleetLedger} from "../docs/lib/fleetweek-study.js";
import {OVERNIGHT_PATTERNS} from "../docs/lib/overnight-markets.js";
import {overnightCases} from "../docs/lib/overnight-study.js";
import {OVERRIDE_PATTERNS, OVERRIDE_FAMILIES, OVERRIDE_TRAIN_FAMILIES} from "../docs/lib/override-markets.js";
import {OVERRIDE_SUITE, OVERRIDE_REFERENCES, OVERRIDE_SPLITS, overrideCases, summarizeOverride} from "../docs/lib/override-study.js";
import {verifyOverrideReport, benchmarkOverride} from "../docs/lib/override-benchmark.js";
import {verifyOvernightReport} from "../docs/lib/overnight-benchmark.js";
import {chooseFleetPlanner} from "../docs/lib/fleetweek-planner.js";

test("override schedules are distinct across generations under depot relabeling and reserve independent seeds", () => {
  const shapes = {...FLEET_PATTERNS, ...OVERNIGHT_PATTERNS, ...OVERRIDE_PATTERNS};
  const canonical = text => [...text].map(c => [...new Set(text)].indexOf(c)).join("");
  for (const shape of Object.values(shapes)) assert.match(shape, /^[012]{10}$/);
  assert.equal(new Set(Object.values(shapes).map(canonical)).size, Object.keys(shapes).length);
  assert.deepEqual(OVERRIDE_FAMILIES.archive, ["double-return"]);
  const training = [...FLEET_FAMILIES.train, ...OVERRIDE_TRAIN_FAMILIES];
  assert.equal(training.length, 11);
  assert(OVERRIDE_SPLITS.every(split => OVERRIDE_FAMILIES[split].every(name => !training.includes(name))));
  const banks = OVERRIDE_SPLITS.map(overrideCases);
  assert.deepEqual(banks.map(list => list.length), [256, 4096, 2048]);
  const old = [...fleetCases("test"), ...fleetCases("validation"), ...OVERRIDE_SPLITS.flatMap(overnightCases)];
  const seeds = [...old, ...banks.flat()].map(row => row.seed);
  assert.equal(new Set(seeds).size, seeds.length);
  assert(banks.flat().every(row => row.seed >= 250000000));
  assert.throws(() => overrideCases("constructor"));
});

test("the zero-margin overrides gate uses paired week intervals, accepts exact matching service and demands positive net", () => {
  function fixture(net, served) {
    const base = {net: 8, served: 5, contracts: 10, gross: 178, penalty: 170, loadedCost: 0, emptyCost: 0, emptyMiles: 0};
    return {family: "fixture", ...Object.fromEntries(OVERRIDE_REFERENCES.map(key => [key, base])),
      agent: {...base, net, served, penalty: 34 * (10 - served), gross: net + 34 * (10 - served)}};
  }
  assert.equal(summarizeOverride([fixture(9,5)]).all.beatsPlanner, true);
  assert.equal(summarizeOverride([fixture(8,5)]).all.beatsPlanner, false);
  const uncertain = summarizeOverride([fixture(9,4), fixture(9,6)]).all;
  assert.equal(uncertain.earnsMoreThanPlanner, true);
  assert.equal(uncertain.comparisons.planner.servicePP, 0);
  assert(uncertain.comparisons.planner.service95[0] < 0);
  assert.equal(uncertain.matchesPlannerService, false);
});

test("an external override agent can replay a validation bank, with tamper and cross-suite rejection", async () => {
  // Synthetic reference scores in this fixture intentionally come from one planner.
  const cases = overrideCases("validation").map(config => {
    const {actions, ledger} = runFleetWeek(config, chooseFleetPlanner);
    const record = {actions, ledger: fleetLedger(ledger)};
    return {...config, ...Object.fromEntries(OVERRIDE_REFERENCES.map(key => [key, record]))};
  });
  const bank = {suite: OVERRIDE_SUITE, split: "validation", cases};
  const report = await benchmarkOverride({split: "validation", policy: "external", bank,
    createPolicy: () => async (obs, legal) => {
      assert(!Object.hasOwn(obs,"seed") && !Object.hasOwn(obs,"family"));
      return chooseFleetPlanner(obs, legal);
    }});
  assert.deepEqual(report.summary.all.comparisons.planner.net95, [0,0]);
  assert.deepEqual(verifyOverrideReport(report, null, bank), report);
  assert.throws(() => verifyOvernightReport(report, null, bank));
  for (const change of [
    r => r.cases.reverse(), r => r.cases.pop(), r => {r.cases[0].actions[1] = "C|C";},
    r => r.cases[0].ledger.served++, r => r.summary.all.comparisons.planner.net95[0]++,
  ]) {
    const damaged = structuredClone(report);
    change(damaged);
    assert.throws(() => verifyOverrideReport(damaged, null, bank));
  }
});
