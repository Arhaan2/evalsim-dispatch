import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {FLEET_PATTERNS} from "../docs/lib/fleetweek.js";
import {PREPOSITION_PATTERNS} from "../docs/lib/preposition-markets.js";
import {PREPOSITION_SPLITS,prepositionCases} from "../docs/lib/preposition-study.js";
import {benchmarkPreposition,verifyPrepositionReport} from "../docs/lib/preposition-benchmark.js";
import {contractComparison,positioningCounts,primaryGoals} from "../training/preposition/contracts.mjs";
const canonical=s=>Array.from(s,c=>[...new Set(s)].indexOf(c)).join("");
test("all new schedules remain distinct even after renaming their depots and all banks have disjoint seeds",async()=>{
  const names=["overnight","override","uncertainty","loss","closure","longrepair","shortdefault","longmove","moverecall","switchcost","addguard"];
  const old=await Promise.all(names.map(async n=>Object.values((await import("../docs/lib/"+n+"-markets.js"))[n.toUpperCase()+"_PATTERNS"])));
  const earlier=new Set([...Object.values(FLEET_PATTERNS),...old.flat()].map(canonical));
  const shapes=Object.values(PREPOSITION_PATTERNS).map(canonical);
  assert.equal(new Set(shapes).size,10);assert(shapes.every(s=>!earlier.has(s)));
  const banks=PREPOSITION_SPLITS.map(prepositionCases);
  assert.deepEqual(banks.map(b=>b.length),[256,32768,4096,4096]);assert.equal(new Set(banks.flat().map(c=>c.seed)).size,41216);
  assert.deepEqual(banks[1][0].closure,{starts:[3,5,7],durations:[1,2,3,4,4,4,5,5,5]});
  assert.deepEqual(banks.map(b=>b[0].seed),[1250000000,1260000000,1270000000,1280000000]);
  assert(banks[2].every(c=>c.closure===null));assert(banks[3].every(c=>c.family==="double-return"&&c.closure===null));
});
test("a Friday save can offset an earlier loss without increasing the weekly number of contracts",()=>{
  const path=()=>({actions:Array(10).fill("W|W"),ledger:{net:0}});
  const row={rl:path(),previous:path(),warningEpoch:6,warningDestinations:{rl:[1,1],previous:[0,2]}};
  row.rl.actions[6]="E1|W";row.previous.actions[6]="C|W";row.rl.actions[8]="W|C";
  const x=contractComparison([row],"previous"), s=positioningCounts([row]);
  assert.equal(x.net,0);assert.equal(x.saved,1);assert.equal(x.lost,1);assert.equal(x.fridaySaved,1);
  assert.equal(s.differentPlacement.weeks,1);assert.equal(s.differentPlacement.emptyMore,1);
  assert.equal(s.all.atWarningLost,1);assert.equal(s.all.afterSaved,1);
  const tied={net95:[0,0.5],service95:[0,0.1]}, win={net95:[.1,.2],service95:[.1,.2]};
  assert.deepEqual(primaryGoals({comparisons:{previous:tied,planner:win}}),{
    deliveriesFit73:false,profitFit73:false,deliveriesPlanner:true,profitPlanner:true,joint:false});
});
test("external dispatcher may use all legal menus, receives public warnings and is verified against the new bank",async()=>{
  const bank=JSON.parse(await readFile(new URL("../docs/data/preposition/validation.json",import.meta.url)));
  let warnings=0;
  const report=await benchmarkPreposition({bank,split:"validation",policy:"Wait",createPolicy:()=>(obs,menu)=>{
    assert(!["family","seed","duration","closure","closedAtEnd"].some(k=>Object.hasOwn(obs,k)));
    if(obs.incident.status==="warning"){warnings++;assert.equal(obs.incident.start,obs.epoch+1);}
    return menu.find(a=>a.id==="W|W").id;
  }});
  assert.equal(warnings,256); assert.deepEqual(verifyPrepositionReport(report,null,bank),report);
  assert.deepEqual(Object.keys(report.summary.all.comparisons),["rl","planner","flatRisk","shortGate","previous","warningPlanner","untrained"]);
  report.cases[0].ledger.served++;
  assert.throws(()=>verifyPrepositionReport(report,null,bank),/ledger/);
});
