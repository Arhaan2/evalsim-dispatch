import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {FLEET_PATTERNS} from "../docs/lib/fleetweek.js";
import {ADDGUARD_PATTERNS} from "../docs/lib/addguard-markets.js";
import {ADDGUARD_SUITE,ADDGUARD_SPLITS,loadAddGuardBank,addGuardCases,addGuardTestShard} from "../docs/lib/addguard-study.js";
import {benchmarkAddGuard,verifyAddGuardReport} from "../docs/lib/addguard-benchmark.js";
import {recognitionGroups} from "../training/addguard/recognition.mjs";

const canonical=pattern=>Array.from(pattern,c=>[...new Set(pattern)].indexOf(c)).join("");
test("registered schedules and seeds are disjoint from earlier studies under all depot relabelings",async()=>{
  const earlier=await Promise.all(["overnight","override","uncertainty","loss","closure","longrepair","shortdefault","longmove","moverecall","switchcost"]
    .map(async name=>Object.values((await import("../docs/lib/"+name+"-markets.js"))[name.toUpperCase()+"_PATTERNS"])));
  const old=new Set([...Object.values(FLEET_PATTERNS),...earlier.flat()].map(canonical));
  const newShapes=Object.values(ADDGUARD_PATTERNS).map(canonical);
  assert.equal(new Set(newShapes).size,10); assert(newShapes.every(s=>!old.has(s)));
  const banks=ADDGUARD_SPLITS.map(addGuardCases);
  assert.deepEqual(banks.map(b=>b.length),[256,65536,4096,4096]);
  assert.equal(new Set(banks.flat().map(c=>c.seed)).size,73984);
  assert(banks.flat().every(c=>c.seed>=1150000000 && c.seed<=1180004095));
  assert.deepEqual(banks.map(rows=>rows[0].seed),[1150000000,1160000000,1170000000,1180000000]);
  for (const c of banks[1]) {
    assert.deepEqual(c.closure.starts,[3,5]); assert.deepEqual(c.closure.durations,[1,2,3,4,4,4,5,5,5]);
    assert(Math.max(...c.closure.starts)+Math.max(...c.closure.durations)<=10);
  }
  assert(banks[2].every(c=>c.closure===null)); assert(banks[3].every(c=>c.closure===null&&c.family==="double-return"));
  assert.throws(()=>addGuardCases("train"),RangeError);
});
test("addition loss and overall recall have separate fixed denominators",()=>{
  // Two labels in one week also exercise clustered resampling.
  const fixed=[[1,-4,true,false,false],[1,9,true,false,true],[2,0,true,false,true],
    [3,8,true,true,true],[4,4,false,false,false],[5,-2,true,true,true],[7,6,false,true,false]]
    .map(([seed,netGain,parent,recall,release])=>({seed,family:"fixture",netGain,serviceGain:0,guardEligible:parent&&!recall,
      previous:{switched:parent},original:{switched:recall},predictions:[{switched:release}]}));
  const {all,added}=recognitionGroups(fixed);
  assert.equal(added.vsParent.n,3); assert.equal(added.vsParent.lossReduction,1/3);
  assert.equal(added.vsParent.dropped.losingCredits,-4); assert.equal(added.vsParent.newLosses,0);
  assert.equal(all.vsParent.n,7); assert.equal(all.vsParent.profitable,4); assert.equal(all.vsParent.previousRecall,.5);
  assert.equal(all.vsParent.recallDifference,0); assert.deepEqual(all.vsParent.recall95,[0,0]);
  assert.equal(all.parentVsMoveRecall.recovered,1); assert.equal(all.parentVsMoveRecall.newlyLost,1);
  assert.equal(all.vsMoveRecall.recallDifference,0);
  const empty=recognitionGroups([]).added.vsParent; assert.equal(empty.loss95,null); assert.equal(empty.recall95,null);
});
test("test shards enforce digests, order, family blocks and sparse recipient reads",async()=>{
  const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
  const fixtures=new Map(), rows=addGuardCases("test");
  const shards=[];
  for (const [family,group] of Map.groupBy(rows,r=>r.family)) {
    const file=addGuardTestShard(shards.length);
    const bytes=JSON.stringify({suite:ADDGUARD_SUITE,split:"test",cases:group.map(({family,seed})=>({family,seed}))});
    fixtures.set(file,bytes); shards.push({family,weeks:8192,file,sha256:sha(bytes)});
  }
  const manifest={suite:ADDGUARD_SUITE,split:"test",shards}, setRoot=()=>{const b=JSON.stringify(manifest); fixtures.set("test.json",b); return sha(b);};
  const calls=[];
  const reader=async(file,digest)=>{calls.push(file);const bytes=fixtures.get(file);assert.equal(sha(bytes),digest,"wrong bytes");return JSON.parse(bytes);};
  const digest=setRoot(), sparse=await loadAddGuardBank("test",reader,digest,[65535,8192]);
  assert.deepEqual(calls,["test.json","test-02.json","test-08.json"]); assert(!sparse.cases[0]); assert(sparse.cases[65535]);
  await assert.rejects(loadAddGuardBank("test",reader,digest,[-1]),RangeError);
  await assert.rejects(loadAddGuardBank("test",reader,null),/digest/);
  await assert.rejects(loadAddGuardBank("test",reader,"f".repeat(64)),/wrong bytes/);
  const first=fixtures.get("test-01.json"); fixtures.set("test-01.json",first+" ");
  await assert.rejects(loadAddGuardBank("test",reader,digest,[0]),/wrong bytes/); fixtures.set("test-01.json",first);
  const flipped=JSON.parse(first); flipped.cases.reverse();const wrongOrder=JSON.stringify(flipped);
  shards[0].sha256=sha(wrongOrder);fixtures.set("test-01.json",wrongOrder);
  await assert.rejects(loadAddGuardBank("test",reader,setRoot(),[0]),/week order/);
  shards[1].file="../test.json";
  await assert.rejects(loadAddGuardBank("test",reader,setRoot(),[]),/shard descriptor/);
});
test("public validation accepts arbitrary legal joint dispatch and rejects tampered reports",async()=>{
  const bank=JSON.parse(await readFile(new URL("../docs/data/addguard/validation.json",import.meta.url)));
  let calls=0;
  const report=await benchmarkAddGuard({bank,split:"validation",policy:"Wait",createPolicy:()=>(obs,menu)=>{
    calls++;assert(!["seed","family","duration","closure"].some(k=>Object.hasOwn(obs,k)));
    return menu.find(a=>a.id==="W|W").id;
  }});
  assert.equal(calls,2560);
  assert.deepEqual(Object.keys(report.summary.all.comparisons),["rl","planner","flatRisk","shortGate","previous","original"]);
  assert.deepEqual(verifyAddGuardReport(report,null,bank),report);
  const forged=structuredClone(report); forged.cases[0].ledger.net++;
  assert.throws(()=>verifyAddGuardReport(forged,null,bank),/ledger/);
  forged.cases[0]=report.cases[0]; forged.summary.durationGroups.long.comparisons.previous.net++;
  assert.throws(()=>verifyAddGuardReport(forged,null,bank),/comparison/);
  forged.suite="dispatch-switchcost-v1";
  assert.throws(()=>verifyAddGuardReport(forged,null,bank),/Unrecognized/);
});
