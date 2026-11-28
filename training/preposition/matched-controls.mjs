// Supplemental mechanism analysis, specified after the registered scores were available.
// Each fit and its zero-head twin use identical observations, rule, hurdle, service price,
// frozen parent and held-out weeks. Only the fitted residual and service coefficients differ.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {prepositionProposal,decisionFromProposal} from "../../docs/lib/preposition-policy.js";
import {loadPrepositionBank,PREPOSITION_SUITE} from "../../docs/lib/preposition-study.js";
import {fleetLedger} from "../../docs/lib/fleetweek-study.js";
import {paired} from "../fleetweek/audit-helpers.mjs";
import {artifact,hash} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data} from "./checkpoints.mjs";

const mode=process.argv[2];
if(!["--write","--check"].includes(mode)) throw Error("Use --write or --check.");
const official=JSON.parse(await readFile(new URL("results.json",data)));
const {weights,fits}=await checkpoints();
assert.equal(official.suite,PREPOSITION_SUITE);
for(const f of fits)assert.equal(f.sha,official.weightHashes[f.seed]);
const bank=await loadPrepositionBank("test",async (file,digest)=>{
  const bytes=await readFile(new URL(file,data));
  assert.equal(hash(bytes),digest);
  return JSON.parse(bytes);
},official.banks.test);
const zeros=fits.map(({model})=>({...model,
  net:model.net.map(()=>0),service:model.service.map(()=>0)}));
const out=fits.map(({seed,model})=>({seed,serviceCredit:model.settings.serviceCredit,hurdle:model.settings.hurdle,
  trainedChanges:0,zeroHeadChanges:0,differentWarnings:0,saved:0,lost:0,netDeliveries:0,totalCredits:0}));
const rows=fits.map(()=>[]);
const served=id=>id.split("|").includes("C");
for(const c of bank.cases){
  // The cache is per tape, keyed by epoch and ordered positions. Distinct placements see distinct menus.
  const cache=new Map();
  function rollout(model) {
    const sim=createClosureWeek(c), actions=[];
    while(!sim.done){
      const obs=sim.observe(), key=9*obs.epoch+3*obs.positions[0]+obs.positions[1];
      if(!cache.has(key))cache.set(key,prepositionProposal(closureFrame(obs),sim.legalActions(),weights));
      const p=cache.get(key), d=decisionFromProposal(p,model);
      if(obs.epoch!==c.warningEpoch)assert.equal(d.chosenId,p.parentId);
      sim.step(d.chosenId);actions.push(d.chosenId);
    }
    return {actions,ledger:fleetLedger(sim.ledger)};
  }
  for(const [i,f] of fits.entries()){
    const candidate=rollout(f.model), control=rollout(zeros[i]), stats=out[i], t=c.warningEpoch;
    assert.deepEqual(candidate.actions.slice(0,t),c.previous.actions.slice(0,t));
    assert.deepEqual(control.actions.slice(0,t),c.previous.actions.slice(0,t));
    if(i===0){assert.deepEqual(candidate,c.rl);assert.deepEqual(control,c.untrained);}
    const trainedId=candidate.actions[t], zeroId=control.actions[t];
    if(trainedId===zeroId)assert.deepEqual(candidate,control);
    if(zeroId===c.previous.actions[t])assert.deepEqual(control,c.previous);
    stats.trainedChanges+=Number(trainedId!==c.previous.actions[t]);
    stats.zeroHeadChanges+=Number(zeroId!==c.previous.actions[t]);
    stats.differentWarnings+=Number(trainedId!==zeroId);
    for(let j=0;j<10;j++){
      const trainedServed=served(candidate.actions[j]), zeroServed=served(control.actions[j]);
      stats.saved+=Number(trainedServed&&!zeroServed);
      stats.lost+=Number(zeroServed&&!trainedServed);
    }
    stats.netDeliveries+=candidate.ledger.served-control.ledger.served;
    stats.totalCredits+=candidate.ledger.net-control.ledger.net;
    rows[i].push({family:c.family,agent:candidate.ledger,control:control.ledger,previous:c.previous.ledger});
  }
}
for(const [i,stats] of out.entries()){
  assert.equal(stats.netDeliveries,stats.saved-stats.lost);
  const comparison=paired(rows[i],"control");
  assert.equal(stats.totalCredits/bank.cases.length,comparison.net);
  assert.equal(10*stats.netDeliveries/bank.cases.length,comparison.servicePP);
  assert.deepEqual(paired(rows[i],"previous"),official.splits.test.fits[i].previous);
  if(i===0)assert.deepEqual(comparison,official.splits.test.fits[0].untrained);
  stats.comparison=comparison;
}
await artifact(data,mode,"matched-controls.json",{suite:PREPOSITION_SUITE,split:"test",weeks:bank.cases.length,
  bankHash:official.banks.test,policyHashes:official.weightHashes,fits:out});
for(const r of out)console.log("Fit",r.seed,"vs its zero-head twin",r.differentWarnings,"different warning actions,",r.netDeliveries,"extra contracts,",r.totalCredits,"extra credits.");
