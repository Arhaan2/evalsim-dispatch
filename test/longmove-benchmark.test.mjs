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
import {LONGMOVE_SPLITS,longMoveCases,benchmarkLongMove,verifyLongMoveReport} from "../docs/lib/longmove-benchmark.js";

test("long-move market patterns are genuinely new and the fresh duration mix is uncensored and balanced across patterns",()=>{
  const canonical = pattern => Array.from(pattern,c=>[...new Set(pattern)].indexOf(c)).join("");
  const earlier = new Set([FLEET_PATTERNS,OVERNIGHT_PATTERNS,OVERRIDE_PATTERNS,UNCERTAINTY_PATTERNS,LOSS_PATTERNS,CLOSURE_PATTERNS,LONGREPAIR_PATTERNS,SHORTDEFAULT_PATTERNS]
    .flatMap(patterns=>Object.values(patterns).map(canonical)));
  const shapes = Object.values(LONGMOVE_PATTERNS).map(canonical);
  assert.equal(new Set(shapes).size,6);
  assert(shapes.every(s=>!earlier.has(s)));
  const banks = LONGMOVE_SPLITS.map(longMoveCases);
  assert.deepEqual(banks.map(b=>b.length),[256,16384,2048,4096]);
  assert.equal(new Set(banks.flat().map(c=>c.seed)).size,22784);
  const valFamilies = new Set(banks[0].map(c=>c.family));
  for (const c of banks[1]) {
    assert(!valFamilies.has(c.family));
    assert.deepEqual(c.closure.starts,[3,5]);
    assert.deepEqual(c.closure.durations,[1,2,3,4,4,4,5,5,5]);
    assert(Math.max(...c.closure.starts)+Math.max(...c.closure.durations)<=10);
  }
  assert(banks[2].every(c=>c.closure===null));
  assert(banks[3].every(c=>c.closure===null && c.family==="double-return"));
  assert.throws(()=>longMoveCases("train"),RangeError);
});

test("custom policies see only public bulletins; replay authenticates schedule, ledger and duration-subgroup scores",async()=>{
  const bank = JSON.parse(readFileSync(new URL("../docs/data/longmove/validation.json",import.meta.url)));
  let weeks = 0, turns = 0;
  const report = await benchmarkLongMove({split:"validation",bank,policy:"Wait",createPolicy:()=>{
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
  assert.deepEqual(Object.keys(report.summary.all.comparisons),["rl","planner","flatRisk","shortGate","longGate","flatGate"]);
  assert.deepEqual(verifyLongMoveReport(report,null,bank),report);
  const altered = structuredClone(report);
  altered.cases[0].closure.durations = [1];
  assert.throws(()=>verifyLongMoveReport(altered,null,bank),/manifest/);
  altered.cases[0]=structuredClone(report.cases[0]);
  altered.cases[0].ledger.net++;
  assert.throws(()=>verifyLongMoveReport(altered,null,bank),/ledger/);
  altered.cases[0]=structuredClone(report.cases[0]);
  altered.summary.durationGroups.long.comparisons.flatRisk.net++;
  assert.throws(()=>verifyLongMoveReport(altered,null,bank),/comparison/);
});

test("detector metrics count missed wins, give equal-score pairs half credit and cluster correlated decisions",async()=>{
  const {detectorStats,detectorInterval}=await import("../training/longmove/detector.mjs");
  const {checkDetectorRows,checkDetectorInterval}=await import("../training/longmove/audit-detector.mjs");
  const rows=[[1,3,.8,true],[1,0,.8,true],[2,-7,.2,false],[3,2,.2,false]].map(([seed,netGain,probability,switched])=>
    ({family:"fixture",seed,netGain,predictions:[{probability,switched}]}));
  const scored=detectorStats(rows,0,.4);
  assert.deepEqual(scored,checkDetectorRows(rows,0,.4));
  assert.equal(scored.tp,1);
  assert.equal(scored.fn,1);
  assert.equal(scored.fp,1);
  assert.equal(scored.tn,1);
  assert.equal(scored.switchedTies,1);
  assert.equal(scored.auroc,.5);
  assert(Math.abs(scored.brier-.34)<1e-12);
  const interval=detectorInterval(rows,.4);
  assert.equal(interval.weeks,3);
  assert(interval.validAuroc<2000);
  assert.deepEqual(interval,checkDetectorInterval(rows,.4));
  const empty=detectorStats([],0,.4);
  assert.equal(empty.brier,null);
  assert.equal(empty.auroc,null);
  const fallback=detectorStats(rows.map(row=>({...row,predictions:[{probability:.4,switched:false}]})),0,.4);
  assert.equal(fallback.precision,null);
  assert.equal(fallback.recall,0);
  assert.equal(fallback.brier,fallback.baseBrier);
});
