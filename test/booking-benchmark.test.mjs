import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { benchmarkBooking, bookingReferences, bookingWeights, verifyBookingReport } from "../docs/lib/booking-benchmark.js";
import { verifySurveyReport } from "../docs/lib/survey-benchmark.js";

const releases = await Promise.all(["booking","survey","rally","trust","closes","drift","turns"].map(async name =>
  JSON.parse(await readFile(new URL("../docs/data/"+name+"/results.json",import.meta.url)))));
const [study] = releases, weights = bookingWeights(...releases), refs = bookingReferences(weights);

test("outside agents can reproduce every Booking reference and target comparison", async () => {
  for (const [split, result] of [["test",study],["retention",study.guard],["archive",study.archive]]) {
    const report = await benchmarkBooking({ split, weights, policy:"outside", createPolicy:() => refs.rl });
    assert.equal(report.cases.length,result.cases.length);
    for (const [i,row] of report.cases.entries()) {
      const expected = result.cases[i];
      assert.equal(row.family,expected.family); assert.equal(row.seed,expected.seed);
      assert.equal(row.net,expected.rl); assert.equal(row.actions.length,8);
      for (const key of Object.keys(refs)) assert.equal(row[key],expected[key],key);
    }
    for (const [stratum,endings] of Object.entries(report.summary.byStratumEnding)) {
      for (const [ending,g] of Object.entries(endings)) {
        const published = result.comparisons.byStratumEnding[stratum][ending];
        assert.equal(g.shifts,published.count);
        for (const [key,suffix] of [["stochastic","Stochastic"],["rally","Rally"],["survey","Survey"],["equal","Equal"]]) {
          assert.deepEqual(g.references[key].interval95,published["rlMinus"+suffix].interval95);
        }
      }
    }
    if (split === "retention") {
      await verifyBookingReport(report,weights);
      await assert.rejects(verifySurveyReport(report,{}),/suite version/);
      report.cases[0].net++;
      await assert.rejects(verifyBookingReport(report,weights),/differ/);
    }
  }
});

test("the early action interventions explain every credit versus the shared-late-policy controls", () => {
  for (const [split, result] of [["test",study],["retention",study.guard],["archive",study.archive]]) {
    const diagnostics = study.audit[split];
    for (const [baseline, groups] of Object.entries(diagnostics)) {
      for (const [key,g] of Object.entries(groups)) {
        const [stratum,ending] = key.split("/");
        const row = key === "all" ? result.comparisons.all : result.comparisons.byStratumEnding[stratum][ending];
        const suffix = baseline[0].toUpperCase()+baseline.slice(1);
        assert.equal(g.shifts,row.count);
        assert.equal(g.byWave.length,6);
        assert.equal(g.net,g.byWave.reduce((sum,w) => sum+w.net,0));
        assert.equal(g.net/g.shifts,row["rlMinus"+suffix].delta);
        for (const w of g.byWave) {
          assert.equal(w.bookings+w.waits,w.differing);
          assert.equal(w.bookingCredits+w.waitCredits,w.net);
        }
      }
    }
  }
});
