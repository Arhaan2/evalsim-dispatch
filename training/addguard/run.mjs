import assert from "node:assert/strict";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {addGuardProposal,addGuardDecision} from "../../docs/lib/addguard-policy.js";
import {ADDGUARD_SUITE,ADDGUARD_SPLITS,ADDGUARD_REFERENCES as refs,addGuardCases,addGuardTestShard,
  summarizeAddGuard,summarizeAddGuardDurations} from "../../docs/lib/addguard-study.js";
import {fleetLedger,pairedFleetComparison,DECISION_MS} from "../../docs/lib/fleetweek-study.js";
import {detectorStats,detectorInterval} from "../longmove/detector.mjs";
import {artifact} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data,fitSeeds} from "./checkpoints.mjs";
import {recognitionGroups,chooseExamples,guardGoals} from "./recognition.mjs";

const mode=process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write to score or --check to reproduce.");
const {weights,hashes,fits}=await checkpoints();
const primary=fits[0].model;
const results={suite:ADDGUARD_SUITE,primarySeed:fitSeeds[0],fitSeeds,
  weightHashes:Object.fromEntries(fits.map(f=>[f.seed,f.sha])),...hashes,banks:{},splits:{}};

function scoreWeek(config) {
  // The freight and notices at each time are exogenous. Ordered truck positions
  // identify the public board within this week; every policy has its own trajectory.
  const proposals=new Map();
  function run(choose) {
    const world=createClosureWeek(config), actions=[];
    let duration=0;
    while (!world.done) {
      const obs=world.observe(), [a,b]=obs.positions, key=9*obs.epoch+3*a+b;
      const start=performance.now();
      if (!proposals.has(key)) proposals.set(key,addGuardProposal(closureFrame(obs),world.legalActions(),weights));
      const id=choose(proposals.get(key),obs);
      assert(performance.now()-start<=DECISION_MS,"Fleet decision exceeded one second.");
      world.step(id);
      actions.push(id);
      duration+=Number(obs.incident.status==="closed");
    }
    return {path:{actions,ledger:fleetLedger(world.ledger)},duration};
  }
  let eligibleBoards=0,vetoedBoards=0;
  const {path:rl,duration}=run(p=>{
    const d=addGuardDecision(p,primary);
    eligibleBoards+=Number(d.guardEligible);
    vetoedBoards+=Number(d.guardVetoed);
    return d.chosenId;
  });
  const fixed=[];
  const {path:shortGate}=run((p,obs)=>{
    if (p.shortId!==p.longId) {
      const predictions=fits.map(f=>{
        const d=addGuardDecision(p,f.model);
        return {switched:d.chosenId===p.longId, guardRisk:d.guardRisk,guardEstimates:d.guardEstimates};
      });
      const previous={switched:p.parent.chosenId===p.longId}, original={switched:p.recallId===p.longId};
      assert.equal(p.guardEligible,previous.switched&&!original.switched);
      fixed.push({epoch:obs.epoch,status:obs.incident.status,shortId:p.shortId,longId:p.longId,
        guardEligible:p.guardEligible,previous,original,predictions});
    }
    return p.shortId;
  });
  const opportunities=fixed.map(o=>{
    const {path:alternative}=run((p,obs)=>obs.epoch<o.epoch ? shortGate.actions[obs.epoch] : obs.epoch===o.epoch ? o.longId : p.shortId);
    return {...o,alternative,netGain:alternative.ledger.net-shortGate.ledger.net,serviceGain:alternative.ledger.served-shortGate.ledger.served};
  });
  const row={...config,duration,opportunities,rl,shortGate,planner:run(p=>p.plannerId).path,flatRisk:run(p=>p.constantId).path,
    previous:run(p=>p.parent.chosenId).path,original:run(p=>p.recallId).path};
  const fitLedgers=[rl.ledger,...fits.slice(1).map(f=>run(p=>addGuardDecision(p,f.model).chosenId).path.ledger)];
  return {row,fitLedgers,eligibleBoards,vetoedBoards};
}

async function storeBank(split,cases) {
  const bank=rows=>({suite:ADDGUARD_SUITE,split,cases:rows});
  if (split!=="test") return artifact(data,mode,split+".json",bank(cases));
  const shards=[];
  for (const [family,group] of Map.groupBy(cases,c=>c.family)) {
    const file=addGuardTestShard(shards.length), sha256=await artifact(data,mode,file,bank(group));
    shards.push({family,file,weeks:group.length,sha256});
  }
  return artifact(data,mode,"test.json",{suite:ADDGUARD_SUITE,split,shards});
}

for (const split of ADDGUARD_SPLITS) {
  const cases=[],rows=[],allFits=[];
  const diagnostics={eligibleBoards:0,vetoedBoards:0,weeksChanged:0,changedActions:0,constantActionDifferences:0,constantWeekDifferences:0};
  for (const config of addGuardCases(split)) {
    const scored=scoreWeek(config), row=scored.row;
    cases.push(row); allFits.push(scored.fitLedgers);
    rows.push({family:row.family,duration:row.duration,agent:row.rl.ledger,...Object.fromEntries(refs.map(k=>[k,row[k].ledger]))});
    const differences=other=>row.rl.actions.filter((id,i)=>id!==row[other].actions[i]).length;
    const parentDiff=differences("previous"), constantDiff=differences("flatRisk");
    diagnostics.eligibleBoards+=scored.eligibleBoards; diagnostics.vetoedBoards+=scored.vetoedBoards;
    diagnostics.changedActions+=parentDiff; diagnostics.weeksChanged+=Number(parentDiff>0);
    diagnostics.constantActionDifferences+=constantDiff; diagnostics.constantWeekDifferences+=Number(constantDiff>0);
  }
  results.banks[split]=await storeBank(split,cases);
  const fixed=cases.flatMap(c=>c.opportunities.map(o=>({...o,seed:c.seed,family:c.family,duration:c.duration})));
  const groupBy=key=>Object.fromEntries(Array.from(Map.groupBy(fixed,r=>r[key]),([name,group])=>[name,recognitionGroups(group)]));
  const detection={...recognitionGroups(fixed),byFamily:Object.fromEntries([...new Set(cases.map(c=>c.family))].map(f=>[f,recognitionGroups(fixed.filter(r=>r.family===f))])),
    byDuration:groupBy("duration")};
  const summary=summarizeAddGuard(rows), scores=fits.map((fit,i)=>{
    const block=rows.map((r,j)=>({...r,agent:allFits[j][i]}));
    const targets=fixed.filter(r=>r.guardEligible).map(r=>({...r,netGain:-r.netGain,predictions:[{
      probability:r.predictions[i].guardEstimates.loss,switched:!r.predictions[i].switched}]}));
    const base=fit.model.calibration.loss.mean;
    const {n,profitable:costly,auroc,brier,baseRate,baseBrier}=detectorStats(targets,0,base);
    const lossForecast={n,costly,auroc,brier,baseRate,baseBrier,...detectorInterval(targets,base)};
    const groups=i===0 ? {all:detection.all,added:detection.added} : recognitionGroups(fixed,i);
    return {seed:fit.seed,lossForecast,net:block.reduce((s,r)=>s+r.agent.net,0)/rows.length,
      onTime:10*(block.reduce((s,r)=>s+r.agent.served,0)/rows.length),
      ...Object.fromEntries(refs.filter(k=>k!=="rl").map(k=>[k,i===0 ? summary.all.comparisons[k] : pairedFleetComparison(block,k)])),
      ...groups};
  });
  results.splits[split]={summary,...summarizeAddGuardDurations(rows),detection,fits:scores,diagnostics,examples:chooseExamples(cases)};
  console.log("Scored",split,cases.length,"weeks,",fixed.length,"disagreements,",detection.added.vsParent.n,"fit-73 additions.");
}
results.goals=guardGoals(results.splits.test.detection,results.splits.test.summary.all,results.splits.archive.summary.all);
await artifact(data,mode,"results.json",results);
