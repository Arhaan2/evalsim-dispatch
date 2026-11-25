import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {benchmarkFleetWeek,verifyFleetReport,replayFleetActions} from "../docs/lib/fleetweek-benchmark.js";
import {fleetCases,pairedFleetComparison} from "../docs/lib/fleetweek-study.js";

test("external policy report reproduces all validation ledgers and catches edits", async () => {
  const bank=JSON.parse(await readFile(new URL("../docs/data/fleetweek/validation.json", import.meta.url)));
  let index=0;
  const createPolicy = () => {
    const path=bank.cases[index++].planner.actions;
    return async (obs, legal) => {
      assert(!Object.hasOwn(obs,"seed") && !Object.hasOwn(obs,"family"));
      assert(legal.some(a=>a.id===path[obs.epoch]));
      return path[obs.epoch];
    };
  };
  const report=await benchmarkFleetWeek({split:"validation",policy:"replay",createPolicy,bank});
  assert.equal(index,256);
  assert.deepEqual(report.summary.all.comparisons.planner.net95,[0,0]);
  assert.deepEqual(verifyFleetReport(report,null,bank),report);
  for (const mutate of [
    r=>r.cases.pop(),r=>r.cases.reverse(),r=>r.cases[0].actions.pop(),
    r=>{r.cases[0].actions[0]="C|C";},r=>r.cases[0].ledger.net++,
    r=>r.summary.all.comparisons.planner.service95[0]++,
  ]) {
    const changed=structuredClone(report);
    mutate(changed);
    assert.throws(()=>verifyFleetReport(changed,null,bank));
  }
});

test("fresh manifest is stable and paired intervals retain week units",()=>{
  const validation=fleetCases("validation"), fresh=fleetCases("test");
  assert.equal(new Set([...validation,...fresh].map(r=>r.seed)).size,2304);
  assert.equal(new Set(fresh.map(r=>r.family)).size,4);
  assert.throws(()=>replayFleetActions(fresh[0],[]));
  const rows=["one","two"].map(family=>({family,agent:{net:18,served:7},other:{net:10,served:8}}));
  assert.deepEqual(pairedFleetComparison(rows,"other"),{net:8,net95:[8,8],servicePP:-10,service95:[-10,-10],wins:2,ties:0,losses:0});
});
