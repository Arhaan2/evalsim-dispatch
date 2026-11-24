import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { benchmarkPaid, paidReferences, paidWeights, verifyPaidReport } from "../docs/lib/paid-benchmark.js";
import { assess } from "../training/paid/evaluate.mjs";
import starter from "../examples/paid-agent.mjs";

const releases = ["paid","booking","survey","rally","trust","closes","drift","turns"].map(k =>
  JSON.parse(readFileSync(new URL("../docs/data/"+k+"/results.json",import.meta.url))));
const weights = paidWeights(...releases), released = releases[0];

test("outside policies replay all nine calls, credit fees and priced controls in the public manifest", async () => {
  const report = await benchmarkPaid({ split:"validation", policy:"external", weights, createPolicy:() => starter });
  const refs = Object.keys(paidReferences(weights));
  for (const [i,row] of report.cases.entries()) {
    assert.equal(row.actions.length,9);
    assert.equal(row.feePaid,Number(row.actions[5] === "buy"));
    assert.equal(row.gross-row.feePaid,row.net);
    assert.equal(row.reading === null,row.feePaid === 0);
    for (const key of refs) assert.equal(row[key],released.splits.validation.cases[i][key]);
    assert.deepEqual(row.bought,released.splits.validation.cases[i].bought);
  }
  assert.deepEqual(await verifyPaidReport(report,weights),report);
  for (const change of [row => row.net++,row => row.feePaid++, row => row.actions[5]="accept",row => row.bought[0]=!row.bought[0]]) {
    const fake=structuredClone(report);
    change(fake.cases[0]);
    await assert.rejects(verifyPaidReport(fake,weights));
  }
});

test("all acquisition interventions reconcile with the released optional and forced policies", () => {
  const { splits, checks } = released;
  assert.deepEqual(checks,assess(splits,1));
  for(const s of Object.values(splits)) {
    for(const [key,prefix] of [["rl","rl"],["planner","planner"]]) {
      const a=s.acquisition.all[key];
      assert.equal(a.net,s.cases.reduce((n,r)=>n+r[key],0));
      assert.equal(a.gross-a.fees,a.net);
      assert.equal(a.bought,a.fees);
      assert.equal(a.buyGain,s.cases.reduce((n,r)=>n+r[key]-r[prefix+"Never"],0));
      assert.equal(a.skipGain,s.cases.reduce((n,r)=>n+r[prefix+"Always"]-r[key],0));
    }
  }
});
