import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {FLEET_PATTERNS} from "../docs/lib/fleetweek.js";
import {FRIDAYGUARD_PATTERNS} from "../docs/lib/fridayguard-markets.js";
import {FRIDAYGUARD_SPLITS,FRIDAYGUARD_REFERENCES,fridayGuardCases,fridayGuardGoals,summarizeFriday} from "../docs/lib/fridayguard-study.js";
import {benchmarkFridayGuard,verifyFridayGuardReport} from "../docs/lib/fridayguard-benchmark.js";

test("Friday guard never shares a fresh market shape or seed with a training or earlier testing family",async()=>{
  const canon=s=>[...s].map(d=>[...new Set(s)].indexOf(d)).join("");
  const historic=["overnight","override","uncertainty","loss","closure","longrepair","shortdefault","longmove","moverecall","switchcost","addguard","preposition"];
  const old=await Promise.all(historic.map(async s=>Object.values((await import("../docs/lib/"+s+"-markets.js"))[s.toUpperCase()+"_PATTERNS"])));
  const seen=new Set([...Object.values(FLEET_PATTERNS),...old.flat()].map(canon));
  const fresh=Object.values(FRIDAYGUARD_PATTERNS).map(canon);
  assert.equal(new Set(fresh).size,10);
  assert(fresh.every(s=>!seen.has(s)));
  const banks=FRIDAYGUARD_SPLITS.map(fridayGuardCases);
  assert.deepEqual(banks.map(b=>b.length),[256,32768,4096,4096]);
  assert.deepEqual(banks.map(b=>b[0].seed),[1450000000,1460000000,1470000000,1480000000]);
  assert.equal(new Set(banks.flat().map(c=>c.seed)).size,41216);
  assert.deepEqual(banks[1][0].closure,{starts:[3,5,7],durations:[1,2,3,4,4,4,5,5,5]});
  assert(banks[2].every(c=>c.closure===null));assert(banks[3].every(c=>c.family==="double-return"&&c.closure===null));
});
test("Friday AM and PM may offset on a single week; zero is retention and fails superiority",()=>{
  const one={family:"a",masks:{agent:1,...Object.fromEntries(FRIDAYGUARD_REFERENCES.map(k=>[k,2]))}};
  const friday=summarizeFriday([one]);
  assert.equal(friday.agentTotal,1);
  assert.deepEqual(friday.comparisons.fit211,{saved:1,lost:1,net:0,perWeek:0,perWeek95:[0,0]});
  const zero={net95:[0,0],service95:[0,0]},comparisons={planner:zero,frozen73:zero,previous:zero};
  assert.deepEqual(fridayGuardGoals(comparisons,friday),{fridayFit211:false,profitPlanner:false,deliveriesFrozen73:false,
    profitFrozen73:false,retainDeliveries101:true,retainProfit101:true,joint:false});
});
test("external agents see public warnings and scorecard verification rejects a fabricated Friday result",async()=>{
  const bank=JSON.parse(await readFile(new URL("../docs/data/fridayguard/validation.json",import.meta.url)));
  let warnings=0;
  const report=await benchmarkFridayGuard({bank,policy:"wait",split:"validation",createPolicy:()=>(obs,menu)=>{
    assert(!["family","seed","duration","closure","closedAtEnd"].some(key=>Object.hasOwn(obs,key)));
    if(obs.incident.status==="warning"){warnings++;assert.equal(obs.epoch+1,obs.incident.start);}
    return menu.find(a=>a.id==="W|W").id;
  }});
  assert.equal(warnings,256);assert.equal(report.summary.all.friday.agentTotal,0);
  assert.deepEqual(verifyFridayGuardReport(report,null,bank),report);
  report.summary.all.friday.comparisons.fit211.saved++;
  assert.throws(()=>verifyFridayGuardReport(report,null,bank),/differs from the verified/);
});
