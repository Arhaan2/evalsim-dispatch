import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {FLEET_PATTERNS} from "../docs/lib/fleetweek.js";
import {OVERNIGHT_PATTERNS} from "../docs/lib/overnight-markets.js";
import {OVERRIDE_PATTERNS} from "../docs/lib/override-markets.js";
import {UNCERTAINTY_PATTERNS} from "../docs/lib/uncertainty-markets.js";
import {LOSS_PATTERNS} from "../docs/lib/loss-markets.js";
import {CLOSURE_PATTERNS} from "../docs/lib/closure-markets.js";
import {LONGREPAIR_PATTERNS} from "../docs/lib/longrepair-markets.js";
import {SHORTDEFAULT_PATTERNS} from "../docs/lib/shortdefault-markets.js";
import {LONGMOVE_PATTERNS} from "../docs/lib/longmove-markets.js";
import {MOVERECALL_PATTERNS} from "../docs/lib/moverecall-markets.js";
import {MOVERECALL_SPLITS,moveRecallCases,benchmarkMoveRecall,verifyMoveRecallReport} from "../docs/lib/moverecall-benchmark.js";

test("move-recall market patterns are genuinely new and the fresh duration mix is uncensored and balanced across patterns",()=>{
  const canonical = pattern => Array.from(pattern,c=>[...new Set(pattern)].indexOf(c)).join("");
  const earlier = new Set([FLEET_PATTERNS,OVERNIGHT_PATTERNS,OVERRIDE_PATTERNS,UNCERTAINTY_PATTERNS,LOSS_PATTERNS,CLOSURE_PATTERNS,LONGREPAIR_PATTERNS,SHORTDEFAULT_PATTERNS,LONGMOVE_PATTERNS]
    .flatMap(patterns=>Object.values(patterns).map(canonical)));
  const shapes = Object.values(MOVERECALL_PATTERNS).map(canonical);
  assert.equal(new Set(shapes).size,10);
  assert(shapes.every(s=>!earlier.has(s)));
  const banks = MOVERECALL_SPLITS.map(moveRecallCases);
  assert.deepEqual(banks.map(b=>b.length),[256,32768,4096,4096]);
  assert.equal(new Set(banks.flat().map(c=>c.seed)).size,41216);
  const valFamilies = new Set(banks[0].map(c=>c.family));
  for (const c of banks[1]) {
    assert(!valFamilies.has(c.family));
    assert.deepEqual(c.closure.starts,[3,5]);
    assert.deepEqual(c.closure.durations,[1,2,3,4,4,4,5,5,5]);
    assert(Math.max(...c.closure.starts)+Math.max(...c.closure.durations)<=10);
  }
  assert(banks[2].every(c=>c.closure===null));
  assert(banks[3].every(c=>c.closure===null && c.family==="double-return"));
  assert.throws(()=>moveRecallCases("train"),RangeError);
});

test("custom policies see only public bulletins; replay authenticates schedule, ledger and duration-subgroup scores",async()=>{
  const bank = JSON.parse(readFileSync(new URL("../docs/data/moverecall/validation.json",import.meta.url)));
  let weeks = 0, turns = 0;
  const report = await benchmarkMoveRecall({split:"validation",bank,policy:"Wait",createPolicy:()=>{
    weeks++;
    return (obs,legal)=>{
      turns++;
      assert.deepEqual(Object.keys(obs.incident).sort(),["depot","start","status","update"]);
      assert(!["family","seed","duration","closure"].some(k=>Object.hasOwn(obs,k)));
      return legal.find(a=>a.id==="W|W").id;
    };
  }});
  assert.equal(weeks,256);
  assert.equal(turns,2560);
  assert.equal(report.summary.durationGroups.long.weeks+report.summary.durationGroups.short.weeks,weeks);
  assert.deepEqual(Object.keys(report.summary.all.comparisons),["rl","planner","flatRisk","shortGate","longGate","flatGate","previous"]);
  assert.deepEqual(verifyMoveRecallReport(report,null,bank),report);
  const altered = structuredClone(report);
  altered.cases[0].closure.durations = [1];
  assert.throws(()=>verifyMoveRecallReport(altered,null,bank),/manifest/);
  altered.cases[0]=structuredClone(report.cases[0]);
  altered.cases[0].ledger.net++;
  assert.throws(()=>verifyMoveRecallReport(altered,null,bank),/ledger/);
  altered.cases[0]=structuredClone(report.cases[0]);
  altered.summary.durationGroups.long.comparisons.flatRisk.net++;
  assert.throws(()=>verifyMoveRecallReport(altered,null,bank),/comparison/);
});

test("paired recall counts rescued and lost wins and preserves correlated decisions in the interval",async()=>{
  const {pairedRecall}=await import("../training/moverecall/paired-recall.mjs");
  const {checkPairedRecall}=await import("../training/moverecall/audit-recall.mjs");
  const rows=[[1,10,true,true],[1,7,false,true],[2,3,true,false],[2,5,false,false],
    [3,-9,false,true],[4,0,false,true],[4,-4,true,false]].map(([seed,netGain,old,take])=>({
    seed,family:"fixture",netGain,serviceGain:netGain>0 ? 1 : 0,previous:{switched:old},predictions:[{switched:take}],
  }));
  const result=pairedRecall(rows,0);
  assert.deepEqual(result,checkPairedRecall(rows,0));
  assert.deepEqual([result.profitable,result.bothCaught,result.recovered,result.newlyLost,result.missedByBoth],[4,1,1,1,1]);
  assert.equal(result.recallDifference,0);
  assert.equal(result.weeks,4);
  assert.deepEqual(result.added,{n:3,wins:1,ties:1,costly:1,credits:-2,contracts:1});
  assert.deepEqual(result.dropped,{n:2,wins:1,ties:0,costly:1,credits:-1,contracts:1});
  const nonwins=pairedRecall(rows.filter(r=>r.netGain<=0),0);
  assert.equal(nonwins.recall95,null);
  assert.equal(nonwins.validRecall,0);
  const empty=pairedRecall([],0);
  assert.equal(empty.recallDifference,null);
  assert.equal(empty.precision,null);
});
