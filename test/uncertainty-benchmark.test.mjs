import assert from "node:assert/strict";
import test from "node:test";
import {FLEET_PATTERNS, runFleetWeek} from "../docs/lib/fleetweek.js";
import {fleetCases, fleetLedger} from "../docs/lib/fleetweek-study.js";
import {OVERNIGHT_PATTERNS} from "../docs/lib/overnight-markets.js";
import {OVERRIDE_PATTERNS} from "../docs/lib/override-markets.js";
import {overnightCases} from "../docs/lib/overnight-study.js";
import {overrideCases} from "../docs/lib/override-study.js";
import {UNCERTAINTY_PATTERNS, UNCERTAINTY_FAMILIES} from "../docs/lib/uncertainty-markets.js";
import {UNCERTAINTY_SUITE, UNCERTAINTY_REFERENCES, UNCERTAINTY_SPLITS, uncertaintyCases, summarizeUncertainty} from "../docs/lib/uncertainty-study.js";
import {verifyUncertaintyReport, benchmarkUncertainty} from "../docs/lib/uncertainty-benchmark.js";
import {verifyOverrideReport} from "../docs/lib/override-benchmark.js";
import {chooseFleetPlanner} from "../docs/lib/fleetweek-planner.js";

test("new uncertainty schedules and seeds exclude earlier banks; archive reuses only the original schedule", () => {
  const shapes = {...FLEET_PATTERNS, ...OVERNIGHT_PATTERNS, ...OVERRIDE_PATTERNS, ...UNCERTAINTY_PATTERNS};
  const canonical = text => [...text].map(c => [...new Set(text)].indexOf(c)).join("");
  for (const shape of Object.values(shapes)) assert.match(shape, /^[012]{10}$/);
  assert.equal(new Set(Object.values(shapes).map(canonical)).size, Object.keys(shapes).length);
  assert.deepEqual(UNCERTAINTY_FAMILIES.archive, ["double-return"]);
  const banks = UNCERTAINTY_SPLITS.map(uncertaintyCases);
  assert.deepEqual(banks.map(list => list.length), [256, 8192, 4096]);
  const earlier = [...fleetCases("test"), ...fleetCases("validation"),
    ...UNCERTAINTY_SPLITS.flatMap(overnightCases), ...UNCERTAINTY_SPLITS.flatMap(overrideCases)];
  const seeds = [...earlier, ...banks.flat()].map(row => row.seed);
  assert.equal(new Set(seeds).size, seeds.length);
  assert(banks.flat().every(row => row.seed >= 350000000));
  assert.throws(() => uncertaintyCases("constructor"));
});

test("the zero-margin uncertainty gate uses paired week intervals, accepts exact matching service and demands positive net", () => {
  function fixture(net, served) {
    const base = {net: 8, served: 5, contracts: 10, gross: 178, penalty: 170, loadedCost: 0, emptyCost: 0, emptyMiles: 0};
    return {family: "fixture", ...Object.fromEntries(UNCERTAINTY_REFERENCES.map(key => [key, base])),
      agent: {...base, net, served, penalty: 34 * (10 - served), gross: net + 34 * (10 - served)}};
  }
  assert.equal(summarizeUncertainty([fixture(9,5)]).all.beatsPlanner, true);
  assert.equal(summarizeUncertainty([fixture(8,5)]).all.beatsPlanner, false);
  const uncertain = summarizeUncertainty([fixture(9,4), fixture(9,6)]).all;
  assert.equal(uncertain.earnsMoreThanPlanner, true);
  assert.equal(uncertain.comparisons.planner.servicePP, 0);
  assert(uncertain.comparisons.planner.service95[0] < 0);
  assert.equal(uncertain.matchesPlannerService, false);
});

test("an external uncertainty agent can replay a validation bank, with tamper and cross-suite rejection", async () => {
  // Synthetic reference scores in this fixture intentionally come from one planner.
  const cases = uncertaintyCases("validation").map(config => {
    const {actions, ledger} = runFleetWeek(config, chooseFleetPlanner);
    const record = {actions, ledger: fleetLedger(ledger)};
    return {...config, ...Object.fromEntries(UNCERTAINTY_REFERENCES.map(key => [key, record]))};
  });
  const bank = {suite: UNCERTAINTY_SUITE, split: "validation", cases};
  const report = await benchmarkUncertainty({split: "validation", policy: "external", bank,
    createPolicy: () => async (obs, legal) => {
      assert(!Object.hasOwn(obs,"seed") && !Object.hasOwn(obs,"family"));
      return chooseFleetPlanner(obs, legal);
    }});
  assert.deepEqual(report.summary.all.comparisons.planner.net95, [0,0]);
  assert.deepEqual(verifyUncertaintyReport(report, null, bank), report);
  assert.throws(() => verifyOverrideReport(report, null, bank));
  for (const change of [
    r => r.cases.reverse(), r => r.cases.pop(), r => {r.cases[0].actions[1] = "C|C";},
    r => r.cases[0].ledger.served++, r => r.summary.all.comparisons.planner.net95[0]++,
  ]) {
    const damaged = structuredClone(report);
    change(damaged);
    assert.throws(() => verifyUncertaintyReport(damaged, null, bank));
  }
});
