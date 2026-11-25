import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {benchmarkOvernight,verifyOvernightReport} from "../docs/lib/overnight-benchmark.js";
import {verifyFleetReport} from "../docs/lib/fleetweek-benchmark.js";

test("outside fleet policies receive public inputs, replay on the overnight bank, and reject altered reports", async()=>{
  const bank=JSON.parse(await readFile(new URL("../docs/data/overnight/validation.json",import.meta.url)));
  let index=0;
  const createPolicy=()=>{
    const actions=bank.cases[index++].planner.actions;
    return async (obs,legal)=>{
      assert(!Object.hasOwn(obs,"family") && !Object.hasOwn(obs,"seed"));
      assert(legal.some(a=>a.id===actions[obs.epoch]));
      return actions[obs.epoch];
    };
  };
  const report=await benchmarkOvernight({split:"validation",policy:"planner replay",createPolicy,bank});
  assert.equal(index,256);
  assert.equal(Object.keys(report.summary.all.comparisons).length,5);
  assert.deepEqual(report.summary.all.comparisons.planner.service95,[0,0]);
  assert.deepEqual(report.summary.all.comparisons.planner.net95,[0,0]);
  assert.deepEqual(verifyOvernightReport(report,null,bank),report);
  assert.throws(()=>verifyFleetReport(report,null,bank));
  for (const change of [r=>r.cases.reverse(),r=>r.cases.pop(),r=>{r.cases[0].actions[1]="C|C";},
    r=>r.cases[0].ledger.emptyMiles++,r=>r.summary.all.comparisons.planner.service95[0]++]) {
    const copy=structuredClone(report); change(copy);
    assert.throws(()=>verifyOvernightReport(copy,null,bank));
  }
});
