// Trace the predeclared Friday diagnostics for all three locked fits on the same
// fresh bank. The official four tests and designated release are independent of this file.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek,closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {prepositionProposal,decisionFromProposal} from "../../docs/lib/preposition-policy.js";
import {loadPrepositionBank,PREPOSITION_SUITE} from "../../docs/lib/preposition-study.js";
import {fleetLedger} from "../../docs/lib/fleetweek-study.js";
import {hash,artifact} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data} from "./checkpoints.mjs";
import {delivered} from "./contracts.mjs";
import {config as training,warningWeek} from "./fit.mjs";

const mode=process.argv[2];
if(!["--write","--check"].includes(mode)) throw Error("Pass --write or --check.");
const official=JSON.parse(await readFile(new URL("results.json",data)));
const {fits,weights}=await checkpoints();
assert.equal(official.suite,PREPOSITION_SUITE);
for(const f of fits) assert.equal(f.sha,official.weightHashes[f.seed]);
const bank=await loadPrepositionBank("test",async(file,expected)=>{
  const bytes=await readFile(new URL(file,data));
  assert.equal(hash(bytes),expected,file+" SHA-256");return JSON.parse(bytes);
},official.banks.test);
const controls=["previous","planner","flatRisk","shortGate","warningPlanner","untrained"];
const empty=id=>id.split("|").filter(s=>s.startsWith("E")).length;
const fitsOut=fits.map(f=>({seed:f.seed,changedWarnings:0,positions:{differentPlacement:0,swappedTrucks:0,samePositions:0,unchanged:0},
  addedEmptyLegs:0,avoidedEmptyLegs:0,saved:0,lost:0,net:0,atWarningSaved:0,atWarningLost:0,
  afterSaved:0,afterLost:0,fridaySaved:0,fridayLost:0,netCredits:0,examples:[]}));
const accounts=fits.map(()=>({credits:0,service:0,comparisons:Object.fromEntries(controls.map(k=>[k,
  {credits:0,service:0,wins:0,ties:0,losses:0}]))}));
for(const row of bank.cases) {
  const {family,seed,closure,warningEpoch:epoch}=row;
  const config={family,seed,closure},previous=row.previous,shared=new Map();
  assert(Number.isInteger(epoch) && epoch<8);
  for(const [i,fit] of fits.entries()) {
    const world=createClosureWeek(config),actions=[],out=fitsOut[i],account=accounts[i];
    let warning=null;
    while(!world.done) {
      const obs=world.observe(),t=obs.epoch;
      const key=t*9+3*obs.positions[0]+obs.positions[1];
      if(!shared.has(key)) shared.set(key,prepositionProposal(closureFrame(obs),world.legalActions(),weights));
      const p=shared.get(key),d=decisionFromProposal(p,fit.model),id=d.chosenId;
      if(d.warning) {
        assert.equal(t,epoch);assert.equal(warning,null);assert.equal(d.parentId,previous.actions[t]);
        const parent=p.menu.find(a=>a.id===d.parentId),chosen=p.menu.find(a=>a.id===id);
        const [a,b]=chosen.positions,[x,y]=parent.positions;
        const group=id===d.parentId?"unchanged":a===x&&b===y?"samePositions":a===y&&b===x?"swappedTrucks":"differentPlacement";
        out.positions[group]++;out.changedWarnings+=Number(group!=="unchanged");
        const extra=empty(id)-empty(d.parentId);
        out.addedEmptyLegs+=Math.max(0,extra);out.avoidedEmptyLegs+=Math.max(0,-extra);
        warning={changed:group!=="unchanged",group};
      } else if(t<epoch || !warning?.changed) assert.equal(id,previous.actions[t]);
      world.step(id);actions.push(id);
    }
    assert(warning);
    const path={actions,ledger:fleetLedger(world.ledger)};
    if(i===0) assert.deepEqual(path,row.rl);
    const delta=path.ledger.served-previous.ledger.served;
    out.net+=delta;out.netCredits+=path.ledger.net-previous.ledger.net;
    for(let t=0;t<10;t++) {
      const change=Number(delivered(actions[t]))-Number(delivered(previous.actions[t]));
      if(!change) continue;
      assert(t>=epoch && warning.changed);
      const saved=change>0;
      out[saved?"saved":"lost"]++;
      out[(t===epoch?"atWarning":"after")+(saved?"Saved":"Lost")]++;
      if(t>=8) {
        out[saved?"fridaySaved":"fridayLost"]++;
        const kind="fit-"+fit.seed+"-"+(saved?"save":"loss");
        if(!out.examples.some(e=>e.kind===kind)) out.examples.push({...config,epoch,fridayEpoch:t,kind,
          chosenId:actions[epoch],alternativeId:previous.actions[epoch],chosenWho:"fit-"+fit.seed,alternativeWho:"previous",
          chosen:path,alternative:previous});
      }
    }
    account.credits+=path.ledger.net;account.service+=path.ledger.served;
    for(const k of controls) {
      const a=account.comparisons[k],net=path.ledger.net-row[k].ledger.net;
      a.credits+=net;a.service+=path.ledger.served-row[k].ledger.served;
      a[net===0?"ties":net>0?"wins":"losses"]++;
    }
  }
}
const weeks=bank.cases.length,fresh=official.splits.test;
assert.equal(weeks,32768);
for(const [i,f] of fitsOut.entries()) {
  const a=accounts[i],o=fresh.fits[i];
  assert.equal(o.seed,f.seed);
  assert.equal(Object.values(f.positions).reduce((s,n)=>s+n,0),weeks);
  assert.equal(f.changedWarnings,weeks-f.positions.unchanged);
  assert.equal(f.saved-f.lost,f.net);assert.equal(f.atWarningSaved+f.afterSaved,f.saved);
  assert.equal(f.atWarningLost+f.afterLost,f.lost);
  assert.equal(f.netCredits,a.comparisons.previous.credits);
  assert.equal(f.net,a.comparisons.previous.service);
  assert.equal(a.credits/weeks,o.net);assert.equal(10*a.service/weeks,o.onTime);
  for(const k of controls) {
    const c=a.comparisons[k];
    assert.equal(c.credits/weeks,o[k].net);
    assert.equal(10*c.service/weeks,o[k].servicePP);
    for(const key of ["wins","ties","losses"]) assert.equal(c[key],o[k][key]);
  }
  f.examples.sort((a,b)=>Number(a.kind.endsWith("loss"))-Number(b.kind.endsWith("loss")));
}
const first=fitsOut[0],p=fresh.positioning;
for(const key of ["atWarningSaved","atWarningLost","afterSaved","afterLost","fridaySaved","fridayLost"])
  assert.equal(first[key],p.all[key]);
assert.equal(first.changedWarnings,fresh.diagnostics.changedWarnings);
for(const [name,count] of Object.entries(first.positions)) assert.equal(count,p[name].weeks);
// Retrospective context for why the selected release rule did or did not activate.
// Only the original training-selection partition enters these epoch counts.
function selectionTiming(model) {
  const byEpoch=Array.from({length:10},(_,epoch)=>({epoch,weeks:0,changed:0,netCredits:0,netContracts:0}));
  for(const [i,family] of training.families.entries()) for(let n=0;n<training.selectionCount;n++) {
    const seed=model.selectionStart+i*training.selectionCount+n;
    const config={seed,family,closure:{starts:training.starts,durations:training.durations}};
    const {proposal,payoff}=warningWeek(config);
    const epoch=closureFrames(config).findIndex(o=>o.incident.status==="warning");
    const b=byEpoch[epoch],decision=decisionFromProposal(proposal,model);
    b.weeks++;
    if(decision.chosenId!==decision.parentId) {
      const a=payoff.get(decision.chosenId),p=payoff.get(decision.parentId);
      b.changed++;b.netCredits+=a.net-p.net;b.netContracts+=a.service-p.service;
    }
  }
  const sum=k=>byEpoch.reduce((s,b)=>s+b[k],0);
  const candidate=model.selection.candidates.find(c=>c.hurdle===model.settings.hurdle&&c.serviceCredit===model.settings.serviceCredit);
  assert.equal(sum("weeks"),model.selection.weeks);assert.equal(sum("changed"),candidate.changed);
  assert.equal(sum("netCredits"),candidate.net);assert.equal(sum("netContracts"),candidate.service);
  return {seed:model.seed,split:"selection",weeks:model.selection.weeks,byEpoch:byEpoch.filter(b=>b.weeks>0)};
}
const report={suite:PREPOSITION_SUITE,split:"test",weeks,bankHash:official.banks.test,
  modelHashes:official.weightHashes,fits:fitsOut,primarySelectionTiming:selectionTiming(fits[0].model)};
await artifact(data,mode,"fit-deliveries.json",report);
for(const f of fitsOut) console.log("Fit",f.seed,"changed",f.changedWarnings,"warnings,",f.net,
  "extra contracts vs parent, Friday saves/losses",f.fridaySaved,f.fridayLost);
