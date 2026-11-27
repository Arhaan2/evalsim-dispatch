// Independent manifest, action replay, accounting, pairings and interval checks.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {closureFrames} from "../../docs/lib/closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "../../docs/lib/closure-planner.js";
import {makeClosurePolicy} from "../../docs/lib/closure-policy.js";
import {makeLongRepairPolicy} from "../../docs/lib/longrepair-policy.js";
import {inspectLongMove} from "../../docs/lib/longmove-policy.js";
import {checkPairedRecall} from "./audit-recall.mjs";
import {inspectMoveRecall} from "../../docs/lib/moverecall-policy.js";
import {paired, publicFrames, replay} from "../fleetweek/audit-helpers.mjs";
import {checkNotices, openMoves} from "../fleetweek/audit-closures.mjs";
import {verifyFleetSplit, verifyScores} from "../fleetweek/verify-split.mjs";

import {checkDetectorRows,checkDetectorInterval} from "../longmove/audit-detector.mjs";

const data = new URL("../../docs/data/moverecall/", import.meta.url);
async function file(name, digest) {
  const bytes = await readFile(new URL(name, data));
  if (digest) assert.equal(createHash("sha256").update(bytes).digest("hex"),digest,name);
  return JSON.parse(bytes);
}
const seeds = [13,37,73,101,211], refs = ["rl","planner","flatRisk","shortGate","longGate","flatGate","previous"];
const fresh = ["recovery-relay","recovery-pivot","recovery-return","recovery-circuit", "recovery-ramp", "recovery-weave", "recovery-diversion", "recovery-exchange"];
const banks = [
  ["validation",["recovery-transfer","recovery-backtrack"],128,950000000,[1],[1,2,3,4,4,5,5]],
  ["test",fresh,4096,960000000,[3,5],[1,2,3,4,4,4,5,5,5]],
  ["clean",fresh,512,970000000,null,null], ["archive",["double-return"],4096,980000000,null,null],
];
const report = await file("results.json");
assert.equal(report.suite,"dispatch-moverecall-v1");
assert.deepEqual(report.fitSeeds,seeds);
assert.equal(report.primarySeed,13);
const weights = {};
for (const name of ["closure","override","uncertainty"]) {
  const registered = (await file("../"+name+"/results.json")).weightHashes[13];
  assert.equal(report[name+"Hash"],registered);
  weights[name] = await file("../"+name+"/model-13.json", registered);
}
const fits = await Promise.all(seeds.map(s => file("fit-"+s+".json", report.weightHashes[s])));
assert.deepEqual(fits.map(m=>m.seed),seeds);
const predecessor = await file("../longrepair/results.json");
assert.equal(report.shortHash,predecessor.shortHash);
assert.equal(report.longHash,predecessor.weightHashes[13]);
weights.short = await file("../longrepair/short-13.json",report.shortHash);
weights.long = await file("../longrepair/fit-13.json",report.longHash);
const previousRelease=await file("../longmove/results.json");
assert.equal(report.previousHash,previousRelease.weightHashes[13]);
weights.previous=await file("../longmove/fit-13.json",report.previousHash);
const old=(o,m)=>inspectLongMove(o,m,weights.previous,weights);
function shouldRescue(estimates,settings) {
  const score=estimates.expectedNet+12*estimates.expectedService-settings.lossPenalty*estimates.expectedDownside;
  return !settings.priorOnly && estimates.winProbability>=settings.minWin && score>settings.hurdle;
}
const short = makeLongRepairPolicy(weights.short,weights), long = makeLongRepairPolicy(weights.long,weights);
const prior = makeClosurePolicy(weights.closure,weights), constant = makeClosureFlatRisk(weights);
const originalConstant = makeUncertaintyPolicy(weights.uncertainty,weights.override,{flatRisk:true});

function auditCase(config, stored) {
  const original = publicFrames(config), frames = closureFrames(config);
  checkNotices(frames,original,config.closure);
  const duration = frames.filter(f => f.incident.status === "closed").length;
  assert.equal(stored.duration,duration);
  const cache = new Map();
  function trace(choose, saved) {
    const actions = [];
    const ledger = replay(frames,(obs,all) => {
      const k = 9*obs.epoch+3*obs.positions[0]+obs.positions[1];
      if (!cache.has(k)) cache.set(k,{obs,legal:openMoves(obs,all)});
      const board = cache.get(k), id = choose(board.obs, board.legal);
      assert(board.legal.some(a=>a.id === id),"Illegal incident move.");
      actions.push(id);
      return id;
    },saved);
    return {actions,ledger};
  }
  const decisions = [], release = (o,m) => inspectMoveRecall(o,m,fits[0],weights).chosenId;
  const primary = trace((obs,menu) => {
    const plannerId = chooseClosurePlanner(obs,menu), closureId = prior(obs,menu), constantId = constant(obs,menu);
    const shortId = short(obs,menu), longId = long(obs,menu);
    const incumbent=old(obs,menu), previousChoiceId=incumbent.chosenId, previousProbability=incumbent.winProbability;
    const detail=inspectMoveRecall(obs,menu,fits[0],weights), {eligible,chosenId,expectedNet,winProbability}=detail;
    assert.equal(eligible,shortId!==longId);
    assert.equal(detail.previousId,previousChoiceId);
    const rescued=eligible && previousChoiceId===shortId && shouldRescue(detail,fits[0].settings);
    const accept=eligible && (previousChoiceId===longId || rescued);
    assert.equal(detail.rescued,rescued);
    assert.equal(chosenId,accept ? longId : shortId);
    if (eligible) {
      assert(["closed","warning"].includes(obs.incident.status));
      decisions.push({epoch:obs.epoch,status:obs.incident.status,winProbability,expectedNet,previousChoiceId,previousProbability,plannerId,closureId,constantId,shortId,longId,chosenId,
        alternativeId:accept ? shortId : longId});
    }
    return chosenId;
  }, stored.rl);
  const planner = trace(chooseClosurePlanner,stored.planner), flat = trace(constant,stored.flatRisk);
  trace(long,stored.longGate);
  trace((o,m)=>old(o,m).chosenId,stored.previous);
  const observed=[];
  const defaultPath=trace((obs,menu)=>{
    const shortId=short(obs,menu), longId=long(obs,menu);
    if (shortId!==longId) {
      const incumbent=old(obs,menu);
      const previous={probability:incumbent.winProbability,switched:incumbent.chosenId===longId};
      const predictions=fits.map(model=>{
        const d=inspectMoveRecall(obs,menu,model,weights);
        const switched=previous.switched || shouldRescue(d,model.settings);
        assert.equal(d.chosenId,switched ? longId : shortId);
        assert.equal(d.previousId,incumbent.chosenId);
        if (previous.switched) assert.equal(d.winProbability,previous.probability);
        return {probability:d.winProbability,switched};
      });
      observed.push({epoch:obs.epoch,shortId,longId,previous,predictions});
    }
    return shortId;
  },stored.shortGate);
  const opportunities=observed.map(o=>{
    const alternative=trace((frame,menu)=>frame.epoch<o.epoch ? defaultPath.actions[frame.epoch] :
      frame.epoch===o.epoch ? o.longId : short(frame,menu));
    return {...o,alternative,netGain:alternative.ledger.net-defaultPath.ledger.net,
      serviceGain:alternative.ledger.served-defaultPath.ledger.served};
  });
  assert.deepEqual(stored.opportunities,opportunities);
  trace((o,m)=>inspectMoveRecall(o,m,fits[0],weights,{flatGate:true}).chosenId,stored.flatGate);
  const ledgers = [primary.ledger,...fits.slice(1).map(model => trace((o,m)=>inspectMoveRecall(o,m,model,weights).chosenId).ledger)];
  if (!config.closure) {
    for (const k of ["rl","longGate","flatGate","shortGate","previous"]) assert.deepEqual(stored[k],flat);
    for (const ledger of ledgers) assert.deepEqual(ledger,flat.ledger);
    replay(original,chooseFleetPlanner,planner);
    replay(original,originalConstant,flat);
  }
  const forks = decisions.map(d => {
    const alternative = trace((o,m)=>o.epoch < d.epoch ? primary.actions[o.epoch] : o.epoch === d.epoch ? d.alternativeId : release(o,m));
    assert.notEqual(d.chosenId,d.alternativeId);
    assert.deepEqual(alternative.actions.slice(0,d.epoch),primary.actions.slice(0,d.epoch));
    return {...config,duration,...d,chosen:primary,alternative,netGain:primary.ledger.net-alternative.ledger.net,
      serviceGain:primary.ledger.served-alternative.ledger.served};
  });
  return {ledgers,forks,opportunities,incidentBoards:frames.filter(f=>["warning","closed"].includes(f.incident.status)).length};
}

function checkConstantGate(group) {
  const short=group.comparisons.shortGate;
  assert.equal(group.earnsMoreThanShortGate,short.net95[0]>0);
  assert.equal(group.matchesShortGateService,short.servicePP>=0 && short.service95[0]>=0);
  assert.equal(group.beatsShortGate,group.earnsMoreThanShortGate && group.matchesShortGateService);
  const c = group.comparisons.flatRisk;
  assert.equal(group.earnsMoreThanFlatRisk,c.net95[0]>0);
  assert.equal(group.matchesFlatRiskService,c.service95[0]>=0 && c.servicePP>=0);
  assert.equal(group.beatsFlatRisk,group.earnsMoreThanFlatRisk && group.matchesFlatRiskService);
}
function medianForks(forks) {
  const out = [];
  for (const defer of [false,true]) for (const sign of [1,-1,0]) {
    const block = forks.filter(f=>(f.chosenId===f.shortId) === defer && Math.sign(f.netGain)===sign);
    if (!block.length) continue;
    const sorted = block.map(f=>f.netGain).sort((a,b)=>a-b), n = sorted.length;
    const mid = (sorted[Math.floor(n/2)] + sorted[Math.floor((n-1)/2)])/2;
    const nearest = Math.min(...sorted.map(v=>Math.abs(v-mid)));
    out.push(block.find(f=>Math.abs(f.netGain-mid)===nearest));
  }
  return out;
}
function counts(forks) {
  const deferred = forks.reduce((n,f)=>n+Number(f.chosenId===f.shortId),0);
  function outcomes(wasAdopted) {
    let wins=0, ties=0, losses=0, totalNet=0, totalServed=0;
    for (const f of forks) {
      if ((f.chosenId===f.longId)!==wasAdopted) continue;
      wins+=Number(f.netGain>0); ties+=Number(f.netGain===0); losses+=Number(f.netGain<0);
      totalNet+=f.netGain; totalServed+=f.serviceGain;
    }
    const n=wins+ties+losses;
    return {wins,ties,losses,net:n ? totalNet/n : null,servicePP:n ? 10*totalServed/n : null};
  }
  return {eligible:forks.length,deferred,switched:forks.length-deferred,
    outcomes:{adopted:outcomes(true),deferred:outcomes(false)}};
}
for (const [split,families,perFamily,firstSeed,starts,durations] of banks) {
  const bank = await file(split+".json",report.banks[split]);
  assert.equal(bank.suite,report.suite);
  assert.equal(bank.split,split);
  assert.equal(bank.cases.length,perFamily*families.length);
  const result = report.splits[split], rows = [], ledgers = [], forks = [], fixed = [];
  let changed = 0, incidentBoards = 0;
  for (const [i,stored] of bank.cases.entries()) {
    const index = Math.floor(i/perFamily), family=families[index];
    const config = {family,seed:firstSeed+index*10000+i%perFamily,closure:starts ? {starts,durations} : null};
    for (const k of Object.keys(config)) assert.deepEqual(stored[k],config[k]);
    const audited = auditCase(config,stored);
    rows.push({family,duration:stored.duration,agent:stored.rl.ledger,...Object.fromEntries(refs.map(k=>[k,stored[k].ledger]))});
    ledgers.push(audited.ledgers);
    forks.push(...audited.forks);
    fixed.push(...audited.opportunities.map(o=>({...o,family,seed:config.seed,duration:stored.duration})));
    incidentBoards += audited.incidentBoards;
    changed += Number(stored.rl.actions.some((a,i)=>a!==stored.shortGate.actions[i]));
  }
  const labels = [...new Set(rows.map(r=>r.duration))].sort();
  assert.deepEqual(result.diagnostics,{...counts(forks),incidentBoards,weeksChanged:changed,forked:forks.length,
    byDuration:Object.fromEntries(labels.map(d=>[d,counts(forks.filter(f=>f.duration===d))]))});
  assert.deepEqual(result.examples,medianForks(forks));
  const expectedDetector=(sample,index)=>({...checkDetectorRows(sample,index,fits[index].calibration.win.mean),
    previous:checkDetectorRows(sample.map(row=>({...row,predictions:[row.previous]})),0,weights.previous.calibration.win.mean),
    vsPrevious:checkPairedRecall(sample,index)});
  const primaryDetector=sample=>({...expectedDetector(sample,0),uncertainty:checkDetectorInterval(sample,fits[0].calibration.win.mean)});
  assert.deepEqual(result.detection,{all:primaryDetector(fixed),fits:seeds.map((seed,i)=>({seed,...expectedDetector(fixed,i)})),
    priorSkipped:primaryDetector(fixed.filter(o=>!o.previous.switched)),
    byFamily:Object.fromEntries(families.map(f=>[f,primaryDetector(fixed.filter(o=>o.family===f))])),
    ...(starts ? {durationGroups:{short:primaryDetector(fixed.filter(o=>o.duration<=3)),long:primaryDetector(fixed.filter(o=>o.duration>=4))}} : {})});
  verifyFleetSplit(rows,ledgers,result,refs,families,seeds);
  for (const g of [result.summary.all,...Object.values(result.summary.byFamily)]) checkConstantGate(g);
  if (starts) {
    assert.deepEqual(labels,[1,2,3,4,5]);
    const blocks = labels.map(d=>[result.byDuration[d],rows.filter(r=>r.duration===d)]);
    blocks.push([result.durationGroups.short,rows.filter(r=>r.duration<=3)],[result.durationGroups.long,rows.filter(r=>r.duration>=4)]);
    for (const [g,sample] of blocks) { verifyScores(sample,g,refs); checkConstantGate(g); }
  } else {
    assert.deepEqual(labels,[0]);
    assert.equal(result.durationGroups,undefined);
    assert.equal(result.byDuration,undefined);
  }
  for (const k of refs) assert.deepEqual(result.versusFlatRisk[k],paired(rows.map(r=>({...r,agent:r[k]})),"flatRisk"));
  for (const [i,fit] of result.fits.entries()) {
    const sample = rows.map((r,j)=>({...r,agent:ledgers[j][i]}));
    for (const k of ["flatRisk","longGate","shortGate","previous"]) assert.deepEqual(fit[k],paired(sample,k));
    if (starts) {
      const actualLong = sample.filter(r=>r.duration===4 || r.duration===5);
      for (const k of ["longGate","shortGate","previous"]) assert.deepEqual(fit.longRepairs[k],paired(actualLong,k));
    } else assert.equal(fit.longRepairs,undefined);
  }
  console.log("Audited",split,rows.length,"weeks,",11*rows.length,"complete trajectories,",forks.length,"deployment forks and",fixed.length,"fixed-path detector opportunities.");
}
const all = report.splits.test.summary.all, doubleReturn = report.splits.archive.summary.all.earnsMoreThanPlanner;
const recall=(report.splits.test.detection.all.vsPrevious.recall95?.[0] ?? -Infinity)>0;
assert.deepEqual(report.goals,{recall,freshProfit:all.earnsMoreThanPlanner,freshService:all.matchesPlannerService,
  freshShortProfit:all.earnsMoreThanShortGate,freshShortService:all.matchesShortGateService,
  freshFlatProfit:all.earnsMoreThanFlatRisk,freshFlatService:all.matchesFlatRiskService,doubleReturn,
  joint:recall && all.beatsPlanner && all.beatsFlatRisk && all.beatsShortGate && doubleReturn});
