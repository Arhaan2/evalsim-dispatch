import assert from "node:assert/strict";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {prepositionProposal,decisionFromProposal} from "../../docs/lib/preposition-policy.js";
import {PREPOSITION_SUITE,PREPOSITION_SPLITS,PREPOSITION_REFERENCES as refs,prepositionCases,prepositionTestShard,
  summarizePreposition,summarizePrepositionDurations} from "../../docs/lib/preposition-study.js";
import {zeroPrepositionHeads} from "../../docs/lib/preposition-benchmark.js";
import {DECISION_MS,fleetLedger,pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {artifact} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data,fitSeeds} from "./checkpoints.mjs";
import {contractComparison,delivered,fridayRounds,primaryGoals,positioningCounts} from "./contracts.mjs";

const mode=process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write or --check.");
const {weights,hashes,fits}=await checkpoints();
const withoutRegressions=zeroPrepositionHeads(fits[0].model);
const results={suite:PREPOSITION_SUITE,primarySeed:fitSeeds[0],fitSeeds,
  weightHashes:Object.fromEntries(fits.map(f=>[f.seed,f.sha])),...hashes,banks:{},splits:{}};

function score(config,examples) {
  // Same freight and repair notice at time t for all routes. Truck IDs are ordered.
  const cache=new Map();
  let warningEpoch=null, duration=0, closedAtEnd=false, warningMenu=null;
  function run(decide) {
    const world=createClosureWeek(config), actions=[];
    while (!world.done) {
      const o=world.observe(), t=o.epoch, key=t*9+o.positions[0]*3+o.positions[1];
      const start=performance.now();
      if (!cache.has(key)) cache.set(key,prepositionProposal(closureFrame(o),world.legalActions(),weights));
      const id=decide(cache.get(key),o);
      assert(performance.now()-start<=DECISION_MS,"Decision took more than a second.");
      world.step(id); actions.push(id);
    }
    return {actions,ledger:fleetLedger(world.ledger)};
  }
  const previous=run((p,o)=>{
    if(p.warning) {assert.equal(warningEpoch,null);warningEpoch=o.epoch;warningMenu=p.menu;}
    if(o.incident.status==="closed"){duration++; if(o.epoch===9)closedAtEnd=true;}
    return p.parentId;
  });
  const fitted=fits.map(f=>run(p=>decisionFromProposal(p,f.model).chosenId));
  const row={...config,duration,warningEpoch,closedAtEnd,rl:fitted[0],previous,
    planner:run(p=>p.plannerId),flatRisk:run(p=>p.constantId),shortGate:run(p=>p.shortId),
    warningPlanner:run(p=>p.warning?p.plannerId:p.parentId),untrained:run(p=>decisionFromProposal(p,withoutRegressions).chosenId),warningDestinations:null};
  if(warningEpoch!==null) {
    const destinations=path=>warningMenu.find(a=>a.id===path.actions[warningEpoch]).positions;
    row.warningDestinations={rl:destinations(row.rl),previous:destinations(previous)};
    assert.deepEqual(previous.actions.slice(0,warningEpoch),row.rl.actions.slice(0,warningEpoch));
    assert(row.rl.actions[warningEpoch]!==previous.actions[warningEpoch] || row.rl.actions.every((a,t)=>a===previous.actions[t]));
    if(examples) {
      function save(kind,chosen,alternative,fridayEpoch,chosenWho,alternativeWho) {
        examples.set(kind,{...config,epoch:warningEpoch,fridayEpoch,kind,
          chosenId:chosen.actions[warningEpoch],alternativeId:alternative.actions[warningEpoch],
          chosenWho,alternativeWho,chosen,alternative});
      }
      for (const [kind,win] of [["agent-save",true],["agent-loss",false]]) {
        if(examples.has(kind))continue;
        const t=fridayRounds.find(t=>delivered(row.rl.actions[t])===win && delivered(previous.actions[t])!==win);
        if(t!==undefined)save(kind,row.rl,previous,t,"rl","previous");
      }
      if(!examples.has("alternative")) {
        for(const action of warningMenu) {
          if(action.id===previous.actions[warningEpoch])continue;
          const alternative=run((p,o)=>o.epoch===warningEpoch?action.id:p.parentId);
          const t=fridayRounds.find(t=>delivered(previous.actions[t])!==delivered(alternative.actions[t]));
          if(t!==undefined){save("alternative",previous,alternative,t,"previous","illustration");break;}
        }
      }
    }
  } else for(const f of fitted)assert.deepEqual(f,previous);
  return {row,ledgers:fitted.map(f=>f.ledger)};
}

async function storeBank(split,cases) {
  const bank=rows=>({suite:PREPOSITION_SUITE,split,cases:rows});
  if(split!=="test")return artifact(data,mode,split+".json",bank(cases));
  const shards=[];
  for(const [family,rows] of Map.groupBy(cases,r=>r.family)) {
    const file=prepositionTestShard(shards.length);
    const sha256=await artifact(data,mode,file,bank(rows));
    shards.push({family,file,weeks:rows.length,sha256});
  }
  return artifact(data,mode,"test.json",{suite:PREPOSITION_SUITE,split,shards});
}
const other=refs.filter(k=>k!=="rl");
for(const split of PREPOSITION_SPLITS) {
  const cases=[],rows=[],fitLedgers=[], examples=new Map();
  const diagnostics={warnings:0,changedWarnings:0,changedWeeks:0,closedAtEnd:0,constantWeekDifferences:0,constantActionDifferences:0};
  for(const config of prepositionCases(split)) {
    const {row,ledgers}=score(config,split==="test"?examples:null);
    cases.push(row);fitLedgers.push(ledgers);
    rows.push({family:row.family,duration:row.duration,agent:row.rl.ledger,...Object.fromEntries(refs.map(k=>[k,row[k].ledger]))});
    if(row.warningEpoch!==null) {
      diagnostics.warnings++;
      diagnostics.changedWarnings+=Number(row.rl.actions[row.warningEpoch]!==row.previous.actions[row.warningEpoch]);
    }
    diagnostics.changedWeeks+=Number(row.rl.actions.some((id,t)=>id!==row.previous.actions[t]));
    diagnostics.closedAtEnd+=Number(row.closedAtEnd);
    const n=row.rl.actions.filter((id,t)=>id!==row.flatRisk.actions[t]).length;
    diagnostics.constantActionDifferences+=n; diagnostics.constantWeekDifferences+=Number(n>0);
  }
  const summary=summarizePreposition(rows);
  const scores=fits.map((f,i)=>{
    const b=rows.map((r,j)=>({...r,agent:fitLedgers[j][i]}));
    return {seed:f.seed,net:b.reduce((s,r)=>s+r.agent.net,0)/b.length,
      onTime:10*(b.reduce((s,r)=>s+r.agent.served,0)/b.length),
      ...Object.fromEntries(other.map(k=>[k,i===0?summary.all.comparisons[k]:pairedFleetComparison(b,k)]))};
  });
  const contracts=Object.fromEntries(other.map(k=>[k,contractComparison(cases,k)]));
  for(const k of other)assert.equal(contracts[k].net*10/cases.length,summary.all.comparisons[k].servicePP);
  results.banks[split]=await storeBank(split,cases);
  results.splits[split]={summary,...summarizePrepositionDurations(rows), fits:scores, diagnostics,contracts,positioning:positioningCounts(cases),
    examples:["agent-save","agent-loss","alternative"].filter(k=>examples.has(k)).map(k=>examples.get(k))};
  console.log("Scored",split,cases.length,"weeks,",diagnostics.changedWarnings,"changed warnings,",contracts.previous.net,"net deliveries vs fit 73.");
}
results.goals=primaryGoals(results.splits.test.summary.all);
await artifact(data,mode,"results.json",results);
