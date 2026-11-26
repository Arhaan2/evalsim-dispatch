import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {makeClosurePolicy,inspectClosure} from "../../docs/lib/closure-policy.js";
import {closureReferences} from "../../docs/lib/closure-benchmark.js";
import {CLOSURE_REFERENCES,CLOSURE_SPLITS,CLOSURE_SUITE,closureCases,summarizeClosure} from "../../docs/lib/closure-study.js";
import {FIT_SEEDS,DECISION_MS,fleetLedger,pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {artifact,hash,legacyCheckpoint} from "../fleetweek/score-helpers.mjs";

const mode=process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write to score or --check to verify.");
const dir=new URL("../../docs/data/closure/",import.meta.url);
const [override,uncertainty]=await Promise.all(["override","uncertainty"].map(name=>legacyCheckpoint(dir,name)));
const fits=await Promise.all(FIT_SEEDS.map(async seed=>{
  const bytes=await readFile(new URL("model-"+seed+".json",dir));
  const model=JSON.parse(bytes);
  assert.equal(seed,model.seed);
  return {seed,model,sha:hash(bytes)};
}));
const primary=fits[0].model, weights={current:primary,override:override.checkpoint,uncertainty:uncertainty.checkpoint};
const policies=closureReferences(weights);
const replicates=fits.slice(1).map(f=>makeClosurePolicy(f.model,weights));
const results={suite:CLOSURE_SUITE,primarySeed:fits[0].seed,fitSeeds:FIT_SEEDS,
  weightHashes:Object.fromEntries(fits.map(f=>[f.seed,f.sha])),overrideHash:override.hash,uncertaintyHash:uncertainty.hash,
  banks:{},splits:{}};

function run(config,policy,prefix=[]) {
  const week=createClosureWeek(config), actions=[];
  while (!week.done) {
    const t=actions.length, obs=week.observe(),menu=week.legalActions();
    const start=performance.now();
    const id=t<prefix.length ? prefix[t] : policy(obs,menu);
    assert(performance.now()-start<=DECISION_MS,"Dispatch exceeded one second");
    week.step(id);
    actions.push(id);
  }
  return {actions,ledger:fleetLedger(week.ledger)};
}
function representatives(examples) {
  const result=[];
  for (const status of ["closed","warning"]) {
    const group=examples.filter(e=>e.status===status);
    for (const sign of [1,-1]) {
      const bucket=group.filter(e=>Math.sign(e.netGain)===sign);
      if (!bucket.length) continue;
      const values=bucket.map(e=>e.netGain).sort((a,b)=>a-b);
      const middle=(values[(values.length-1)>>1]+values[values.length>>1])/2;
      const best=bucket.reduce((a,b)=>Math.abs(a.netGain-middle)<=Math.abs(b.netGain-middle) ? a : b);
      result.push(best);
    }
  }
  return !result.length && examples.length ? [examples[0]] : result;
}
for (const split of CLOSURE_SPLITS) {
  const weeks=closureCases(split);
  const diagnostics={incidentBoards:0,eligible:0,switched:0,weeksChanged:0,forked:0};
  const samples=[],families=new Map(),cases=[],allFits=[];
  for (const config of weeks) {
    const index=families.get(config.family) ?? 0;
    families.set(config.family,index+1);
    const decisions=[];
    const rl=run(config,(obs,menu)=>{
      const d=inspectClosure(obs,menu,primary,weights);
      if (["warning","closed"].includes(obs.incident.status)) {
        diagnostics.incidentBoards++;
        if (d.proposalId!=null) {
          diagnostics.eligible++;
          const switched=d.chosenId!==d.constantId;
          diagnostics.switched+=Number(switched);
          if (index<32) decisions.push({epoch:obs.epoch,status:obs.incident.status,plannerId:d.plannerId,
            constantId:d.constantId,proposalId:d.proposalId,chosenId:d.chosenId,alternativeId:switched ? d.constantId : d.proposalId});
        }
      }
      return d.chosenId;
    });
    const planner=run(config,policies.planner),flatRisk=run(config,policies.flatRisk);
    diagnostics.weeksChanged+=Number(rl.actions.some((id,t)=>id!==flatRisk.actions[t]));
    cases.push({...config,rl,planner,flatRisk});
    for (const d of decisions) {
      assert.notEqual(d.chosenId,d.alternativeId);
      const alternate=run(config,policies.rl,[...rl.actions.slice(0,d.epoch),d.alternativeId]);
      samples.push({...config,...d,chosen:rl,alternative:alternate,netGain:rl.ledger.net-alternate.ledger.net,
        serviceGain:rl.ledger.served-alternate.ledger.served});
    }
    allFits.push([rl.ledger,...replicates.map(policy=>run(config,policy).ledger)]);
  }
  diagnostics.forked=samples.length;
  results.banks[split]=await artifact(dir,mode,split+".json",{suite:CLOSURE_SUITE,split,cases});
  const rows=cases.map(row=>({family:row.family,agent:row.rl.ledger,...Object.fromEntries(CLOSURE_REFERENCES.map(k=>[k,row[k].ledger]))}));
  const summary=summarizeClosure(rows);
  function against(key) {
    return Object.fromEntries(CLOSURE_REFERENCES.map(k=>[k,k==="rl" ? summary.all.comparisons[key] :
      pairedFleetComparison(rows.map(r=>({...r,agent:r[k]})),key)]));
  }
  const scores=fits.map(({seed},i)=>{
    const block=rows.map((r,j)=>({...r,agent:allFits[j][i]}));
    return {seed,net:block.reduce((s,r)=>s+r.agent.net,0)/block.length,onTime:10*block.reduce((s,r)=>s+r.agent.served,0)/block.length,
      planner:pairedFleetComparison(block,"planner"),flatRisk:pairedFleetComparison(block,"flatRisk")};
  });
  results.splits[split]={summary,fits:scores,versusPlanner:against("planner"),versusFlatRisk:against("flatRisk"),diagnostics,examples:representatives(samples)};
  console.log("Scored",split,cases.length,"weeks and",samples.length,"paired incident decisions.");
}
const test=results.splits.test.summary.all, doubleReturn=results.splits.archive.summary.all.earnsMoreThanPlanner;
results.goals={freshProfit:test.earnsMoreThanPlanner,freshService:test.matchesPlannerService,
  freshFlatProfit:test.earnsMoreThanFlatRisk,freshFlatService:test.matchesFlatRiskService,
  doubleReturn,joint:doubleReturn && test.beatsPlanner && test.beatsFlatRisk};
await artifact(dir,mode,"results.json",results);
