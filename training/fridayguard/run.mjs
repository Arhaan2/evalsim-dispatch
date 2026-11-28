import assert from "node:assert/strict";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {fridayGuardProposal,decideFridayGuard} from "../../docs/lib/fridayguard-policy.js";
import {FRIDAYGUARD_SUITE,FRIDAYGUARD_SPLITS,FRIDAYGUARD_REFERENCES as refs,fridayGuardCases,
  fridayGuardMetadata,fridayGuardTestShard,fridayGuardGoals,weeklyGuardTotals,summarizeFriday,summarizeFridayGuard} from "../../docs/lib/fridayguard-study.js";
import {DECISION_MS,fleetLedger,pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {artifact} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data,fitSeeds} from "./checkpoints.mjs";
import {guardEvidence} from "./contracts.mjs";

const mode=process.argv[2];
if(!["--write","--check"].includes(mode))throw Error("Use --write or --check.");
const {weights,hashes,fits}=await checkpoints();
const results={suite:FRIDAYGUARD_SUITE,primarySeed:fitSeeds[0],fitSeeds,
  weightHashes:Object.fromEntries(fits.map(f=>[f.seed,f.sha])),...hashes,banks:{},splits:{}};

function score(config) {
  const cache=new Map();
  let warningEpoch=null,duration=0,closedAtEnd=false;
  function rollout(choose) {
    const world=createClosureWeek(config),actions=[];
    while(!world.done) {
      const o=world.observe(),key=9*o.epoch+3*o.positions[0]+o.positions[1];
      const start=performance.now();
      if(!cache.has(key))cache.set(key,fridayGuardProposal(closureFrame(o),world.legalActions(),weights));
      const id=choose(cache.get(key),o);
      assert(performance.now()-start<=DECISION_MS,"Decision exceeded the one-second limit.");
      world.step(id);actions.push(id);
    }
    return {actions,ledger:fleetLedger(world.ledger)};
  }
  const previous=rollout((p,o)=>{
    if(p.warning){assert.equal(warningEpoch,null);warningEpoch=o.epoch;}
    if(o.incident.status==="closed"){duration++;closedAtEnd=o.epoch===9;}
    return p.fit101Id;
  });
  const paths=fits.map(f=>rollout(p=>decideFridayGuard(p,f.model)));
  const row={...config,warningEpoch,duration,closedAtEnd,rl:paths[0],previous,
    fit211:rollout(p=>p.fit211Id),frozen73:rollout(p=>p.parentId),planner:rollout(p=>p.plannerId)};
  return {row,paths};
}
async function storeBank(split,cases) {
  const bank=rows=>({suite:FRIDAYGUARD_SUITE,split,cases:rows});
  if(split!=="test")return artifact(data,mode,split+".json",bank(cases));
  const shards=[];
  for(const [family,rows] of Map.groupBy(cases,r=>r.family)) {
    const file=fridayGuardTestShard(shards.length);
    shards.push({family,file,weeks:rows.length,sha256:await artifact(data,mode,file,bank(rows))});
  }
  return artifact(data,mode,"test.json",{suite:FRIDAYGUARD_SUITE,split,shards});
}

for(const split of FRIDAYGUARD_SPLITS) {
  const cases=[],paths=fits.map(()=>[]);
  for(const config of fridayGuardCases(split)) {
    const result=score(config);cases.push(result.row);
    for(const [i,p] of result.paths.entries())paths[i].push(p);
  }
  function observations(i) {
    return cases.map((c,j)=>({family:c.family,agent:paths[i][j].ledger,...fridayGuardMetadata(c,paths[i][j]),
      ...Object.fromEntries(refs.map(k=>[k,c[k].ledger]))}));
  }
  const primary=observations(0),summary=summarizeFridayGuard(primary);
  const table=fits.map((f,i)=>{
    const rows=i===0?primary:observations(i);
    const comparisons=i===0?summary.all.comparisons:Object.fromEntries(refs.map(k=>[k,pairedFleetComparison(rows,k)]));
    const friday=i===0?summary.all.friday:summarizeFriday(rows);
    const evidence=guardEvidence(cases,paths[i]);
    const {prevented,introduced,surrendered,newGains}=evidence.lossAccounting;
    assert.equal(friday.comparisons.previous.saved,prevented+newGains);
    assert.equal(friday.comparisons.previous.lost,introduced+surrendered);
    return {seed:f.seed,net:rows.reduce((s,r)=>s+r.agent.net,0)/rows.length,
      onTime:10*rows.reduce((s,r)=>s+r.agent.served,0)/rows.length,
      comparisons,weeklyTotals:weeklyGuardTotals(comparisons,rows.length),friday,goals:fridayGuardGoals(comparisons,friday),...evidence};
  });
  results.banks[split]=await storeBank(split,cases);
  results.splits[split]={summary,fits:table,closedAtEnd:cases.filter(r=>r.closedAtEnd).length};
  console.log("Scored",split,cases.length,"weeks,",table[0].decisions.changedWarnings,"changed incumbent warnings.");
}
results.goals=results.splits.test.summary.all.goals;
await artifact(data,mode,"results.json",results);
