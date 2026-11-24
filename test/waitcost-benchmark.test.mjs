import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WAITCOST_KEYS, benchmarkWaitcost, decodeWaitcostCase, verifyWaitcostReport } from "../docs/lib/waitcost-benchmark.js";
import { WAITCOST_PATTERNS, waitcostCases } from "../docs/lib/waitcost.js";
import { assess } from "../training/waitcost/evaluate.mjs";
import starter from "../examples/lastslot-agent.mjs";
const data=file=>JSON.parse(readFileSync(new URL("../docs/data/waitcost/"+file+".json",import.meta.url)));
const {weights,splits,checks}=data("desk"), split="validation",bank=data(split);

test("external nine-action reports replay the fresh suite against computed and packaged baselines",async()=>{
  const settings={weights,split,policy:"starter",createPolicy:()=>starter};
  const report=await benchmarkWaitcost({...settings,bank});
  assert.deepEqual(await benchmarkWaitcost(settings),report);
  assert.deepEqual(await verifyWaitcostReport(report,weights,bank),report);
  const free=report.cases.map(row=>decodeWaitcostCase(split,row)).find(r=>r.priceCents===0 && r.actions[5]==="buy");
  assert.equal(free.feeCents,0);
  assert.notEqual(free.reading,null);
  for(const [field,value] of [[2,17],[3,512],[4,99999],[5,200],[6,7]]) {
    const bad=structuredClone(report);
    bad.cases[0][field]=value;
    await assert.rejects(verifyWaitcostReport(bad,weights,bank));
  }
});
test("load choice and fees reconcile to actual and forced branch earnings",()=>{
  assert.deepEqual(checks,assess(splits,1));
  const manifest=waitcostCases(split);
  const groups=splits[split].opportunities;
  for(const [group,{positive:o}] of Object.entries(groups)) {
    const selected=manifest.map((c,i)=>({c,i,p:WAITCOST_PATTERNS[c.family]})).filter(({c,p})=>
      c.priceCents && (group==="all" || group===p.stratum+"/"+p.ending));
    const eligible=selected.filter(({i})=>bank.slots[i]===1);
    assert.equal(o.oneSlot,eligible.length);
    assert.equal(o.forced.runs,eligible.length);
    for(const [mechanism,rows] of [[o.forced,eligible],[o.purchases,eligible.filter(({i})=>bank.scores[i][0]&1)]]) {
      assert.equal(mechanism.runs,rows.length);
      const switched=rows.filter(({i})=>bank.loads[i][0]!==bank.loads[i][1]);
      assert.equal(mechanism.changed,switched.length);
      assert.equal(mechanism.higher+mechanism.lower+mechanism.equal,switched.length);
      const w=mechanism.wait;
      const guarded=1+WAITCOST_KEYS.indexOf("rlAlways"),unprotected=1+WAITCOST_KEYS.indexOf("unguardedAlways");
      const corrected=rows.filter(({i})=>bank.loads[i][0]!==bank.loads[i][2]);
      assert.equal(w.interventions,corrected.length);
      assert.equal(w.saved+w.costly+w.tied,w.interventions);
      assert.equal(w.guardGainCents,rows.reduce((total,{i})=>total+bank.scores[i][guarded]-bank.scores[i][unprotected],0));
      for(const [name,branch,key] of [["guarded",0,guarded],["unguarded",2,unprotected]]) {
        const later=rows.filter(({i})=>(bank.loads[i][branch]||9)>(bank.loads[i][1]||9));
        assert.equal(w[name+"Later"],later.length);
        assert.equal(w[name+"Harmful"],later.filter(({c,i})=>bank.scores[i][key]+c.priceCents<bank.scores[i][2]).length);
      }
      const gross=rows.reduce((sum,{c,i})=>sum+bank.scores[i][4]+c.priceCents-bank.scores[i][2],0);
      assert.equal(mechanism.grossDeltaCents,gross);
    }
    assert.equal(o.buyGainCents,o.purchases.grossDeltaCents-o.feeCents);
  }
});
