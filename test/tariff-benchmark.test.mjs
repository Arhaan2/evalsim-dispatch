import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { benchmarkTariff, verifyTariffReport } from "../docs/lib/tariff-benchmark.js";
import { assess } from "../training/tariff/evaluate.mjs";
import starter from "../examples/tariff-agent.mjs";

const json = filename => JSON.parse(readFileSync(new URL("../docs/data/tariff/"+filename,import.meta.url)));
const desk=json("desk.json"), release=json("results.json");
test("priced reports reconcile free purchases and all conditional charges and reject altered price, charge or calls", async()=>{
  const report=await benchmarkTariff({split:"validation",policy:"external starter",weights:desk.weights,createPolicy:()=>starter});
  assert.equal(report.cases.length,896);
  assert(report.cases.some(r=>r.actions[5]==="buy" && r.feeCents===0));
  for (const [i,r] of report.cases.entries()) {
    assert.equal(r.feeCents,r.actions[5]==="buy" ? r.priceCents : 0);
    assert.equal(r.netCents,r.grossCents-r.feeCents);
    const expected=release.splits.validation.cases[i];
    for (const k of Object.keys(report.summary.all.references)) assert.equal(r[k],expected[k]);
    assert.deepEqual(r.bought,expected.bought);
  }
  await verifyTariffReport(report,desk.weights);
  for (const mutate of [r=>r.priceCents++,r=>r.feeCents++,r=>r.actions[5]="accept"]) {
    const changed=structuredClone(report);
    mutate(changed.cases[0]);
    await assert.rejects(verifyTariffReport(changed,desk.weights));
  }
});
test("the seven tariff versions are clustered with each tape, and forced acquisition returns reconcile",()=>{
  assert.deepEqual(assess(release.splits,1),release.checks);
  for (const [split,s] of Object.entries(release.splits)) {
    assert.deepEqual(s.summary,desk.splits[split].summary);
    const {all,positive,byPrice}=s.summary;
    assert.equal(all.shifts,all.tapes*7);
    assert.equal(positive.shifts,all.tapes*6);
    for (const [cents,{all:g}] of Object.entries(byPrice)) {
      assert.equal(g.tapes,all.tapes); assert.equal(g.shifts,all.tapes);
      for (const key of ["rl","planner"]) {
        const a=s.acquisition.all[cents][key], ref=g.references[key];
        assert.equal(a.bought,ref.bought);assert.equal(a.feeCents,ref.bought*Number(cents));
        assert(Math.abs(a.buyGainCents/100/g.shifts-(ref.mean-g.references[key+"Never"].mean))<1e-9);
        assert(Math.abs(a.skipGainCents/100/g.shifts-(g.references[key+"Always"].mean-ref.mean))<1e-9);
      }
    }
  }
});
