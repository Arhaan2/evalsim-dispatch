import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { benchmarkLastslot,decodeLastslotCase,verifyLastslotReport,LASTSLOT_KEYS } from "../docs/lib/lastslot-benchmark.js";
import { assess } from "../training/lastslot/evaluate.mjs";
import starter from "../examples/lastslot-agent.mjs";
const read=k=>JSON.parse(fs.readFileSync(new URL("../docs/data/lastslot/"+k+".json",import.meta.url)));
const {weights,splits,checks}=read("desk"),bank=read("validation");

test("compact one-slot reports verify price, all nine calls, signal and the cent ledger, including free acquisitions",async()=>{
  const options={weights,split:"validation",policy:"outside",createPolicy:()=>starter};
  const report=await benchmarkLastslot({...options,bank});
  assert.deepEqual(report,await benchmarkLastslot(options));
  assert.deepEqual(report,await verifyLastslotReport(report,weights,bank));
  const rows=report.cases.map(r=>decodeLastslotCase("validation",r));
  assert(rows.some(r=>r.actions[5]==="buy" && r.feeCents===0 && r.reading!==null));
  for(const row of rows) assert.equal(row.feeCents,row.actions[5]==="buy"?row.priceCents:0);
  for(const i of [2,3,4,5,6]) {
    const fake=structuredClone(report);
    fake.cases[0][i]=i===6?99:fake.cases[0][i]+1;
    await assert.rejects(verifyLastslotReport(fake,weights,bank));
  }
});
test("controlled one-slot comparisons and own capacity counts match the frozen validation bank",()=>{
  assert.deepEqual(checks,assess(splits,1));
  const outcome=splits.validation;
  assert.equal(outcome.matched.all.shifts,bank.matched.filter(Boolean).length);
  assert.equal(outcome.opportunities.all.all.oneSlot,bank.slots.filter(s=>s===1).length);
  const i=LASTSLOT_KEYS.indexOf("rl"),j=LASTSLOT_KEYS.indexOf("rlNever");
  bank.scores.forEach((row,k)=>{
    if(row[0]&(1<<i)) assert.equal(bank.slots[k],1);
    else assert.equal(row[1+i],row[1+j]);
  });
  for(const [name,k] of [["rlNever",2],["planner",3]]) {
    const paired=bank.matched.filter(Boolean);
    const difference=paired.reduce((n,r)=>n+r[1]-r[k],0)/(paired.length*100);
    assert(Math.abs(outcome.matched.all.references[name].delta-difference)<1e-10);
  }
});
