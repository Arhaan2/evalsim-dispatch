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
import {SWITCHCOST_PATTERNS} from "../docs/lib/switchcost-markets.js";
import {SWITCHCOST_SPLITS,switchCostCases,benchmarkSwitchCost,verifySwitchCostReport} from "../docs/lib/switchcost-benchmark.js";

test("switch-cost market patterns are genuinely new and the fresh duration mix is uncensored and balanced across patterns",()=>{
  const canonical = pattern => Array.from(pattern,c=>[...new Set(pattern)].indexOf(c)).join("");
  const earlier = new Set([FLEET_PATTERNS,OVERNIGHT_PATTERNS,OVERRIDE_PATTERNS,UNCERTAINTY_PATTERNS,LOSS_PATTERNS,CLOSURE_PATTERNS,LONGREPAIR_PATTERNS,SHORTDEFAULT_PATTERNS,LONGMOVE_PATTERNS,MOVERECALL_PATTERNS]
    .flatMap(patterns=>Object.values(patterns).map(canonical)));
  const shapes = Object.values(SWITCHCOST_PATTERNS).map(canonical);
  assert.equal(new Set(shapes).size,10);
  assert(shapes.every(s=>!earlier.has(s)));
  const banks = SWITCHCOST_SPLITS.map(switchCostCases);
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
  assert.throws(()=>switchCostCases("train"),RangeError);
});

test("custom policies see only public bulletins; replay authenticates schedule, ledger and duration-subgroup scores",async()=>{
  const bank = JSON.parse(readFileSync(new URL("../docs/data/switchcost/validation.json",import.meta.url)));
  let weeks = 0, turns = 0;
  const report = await benchmarkSwitchCost({split:"validation",bank,policy:"Wait",createPolicy:()=>{
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
  assert.deepEqual(Object.keys(report.summary.all.comparisons),["rl","planner","flatRisk","shortGate","longGate","flatGate","previous","original"]);
  assert.deepEqual(verifySwitchCostReport(report,null,bank),report);
  const altered = structuredClone(report);
  altered.cases[0].closure.durations = [1];
  assert.throws(()=>verifySwitchCostReport(altered,null,bank),/manifest/);
  altered.cases[0]=structuredClone(report.cases[0]);
  altered.cases[0].ledger.net++;
  assert.throws(()=>verifySwitchCostReport(altered,null,bank),/ledger/);
  altered.cases[0]=structuredClone(report.cases[0]);
  altered.summary.durationGroups.long.comparisons.flatRisk.net++;
  assert.throws(()=>verifySwitchCostReport(altered,null,bank),/comparison/);
});
