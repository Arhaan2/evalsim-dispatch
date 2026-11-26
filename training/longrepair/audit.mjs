// Independent manifest, action replay, accounting, pairings and interval checks.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {closureFrames} from "../../docs/lib/closure-world.js";
import {chooseClosurePlanner, makeClosureFlatRisk} from "../../docs/lib/closure-planner.js";
import {makeClosurePolicy} from "../../docs/lib/closure-policy.js";
import {inspectLongRepair} from "../../docs/lib/longrepair-policy.js";
import {paired, publicFrames, replay} from "../fleetweek/audit-helpers.mjs";
import {checkNotices, openMoves} from "../fleetweek/audit-closures.mjs";
import {verifyFleetSplit, verifyScores} from "../fleetweek/verify-split.mjs";

const data = new URL("../../docs/data/longrepair/", import.meta.url);
async function file(name, digest) {
  const bytes = await readFile(new URL(name, data));
  if (digest) assert.equal(createHash("sha256").update(bytes).digest("hex"),digest,name);
  return JSON.parse(bytes);
}
const seeds = [13,37,73,101,211], refs = ["rl","planner","flatRisk","closure","flatGate","shortGate"];
const fresh = ["prolonged-return","prolonged-relay","prolonged-backtrack","prolonged-rally"];
const banks = [
  ["validation",["prolonged-loop","prolonged-transfer"],128,650000000,[1],[1,2,3,4,4,5,5]],
  ["test",fresh,2048,660000000,[3,5],[1,2,3,4,4,4,5,5,5]],
  ["clean",fresh,512,670000000,null,null], ["archive",["double-return"],4096,680000000,null,null],
];
const report = await file("results.json");
assert.equal(report.suite,"dispatch-longrepair-v1");
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
const short = await file("short-13.json",report.shortHash);
assert.equal(short.seed,13);
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
  const decisions = [], release = (o,m) => inspectLongRepair(o,m,fits[0],weights).chosenId;
  const primary = trace((obs,menu) => {
    const plannerId = chooseClosurePlanner(obs,menu), closureId = prior(obs,menu), constantId = constant(obs,menu);
    const {eligible,chosenId,score} = inspectLongRepair(obs,menu,fits[0],weights);
    assert.equal(eligible,closureId !== constantId);
    const accept = eligible && !fits[0].settings.constantOnly && score > fits[0].settings.hurdle;
    assert.equal(chosenId,accept ? closureId : constantId);
    if (eligible) {
      assert(["closed","warning"].includes(obs.incident.status));
      decisions.push({epoch:obs.epoch,status:obs.incident.status,plannerId,closureId,constantId,chosenId,
        alternativeId:accept ? constantId : closureId});
    }
    return chosenId;
  }, stored.rl);
  const planner = trace(chooseClosurePlanner,stored.planner), flat = trace(constant,stored.flatRisk);
  // The manifest reserves closure for the timing profile. The released prior trajectory is closurePolicy.
  trace(prior,stored.closurePolicy);
  trace((o,m)=>inspectLongRepair(o,m,fits[0],weights,{flatGate:true}).chosenId,stored.flatGate);
  trace((o,m)=>inspectLongRepair(o,m,short,weights).chosenId,stored.shortGate);
  const ledgers = [primary.ledger,...fits.slice(1).map(model => trace((o,m)=>inspectLongRepair(o,m,model,weights).chosenId).ledger)];
  if (!config.closure) {
    for (const k of ["rl","closurePolicy","flatGate","shortGate"]) assert.deepEqual(stored[k],flat);
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
  return {ledgers,forks,incidentBoards:frames.filter(f=>["warning","closed"].includes(f.incident.status)).length};
}

function checkConstantGate(group) {
  const c = group.comparisons.flatRisk;
  assert.equal(group.earnsMoreThanFlatRisk,c.net95[0]>0);
  assert.equal(group.matchesFlatRiskService,c.service95[0]>=0 && c.servicePP>=0);
  assert.equal(group.beatsFlatRisk,group.earnsMoreThanFlatRisk && group.matchesFlatRiskService);
}
function medianForks(forks) {
  const out = [];
  for (const defer of [false,true]) for (const sign of [1,-1]) {
    const block = forks.filter(f=>(f.chosenId===f.constantId) === defer && Math.sign(f.netGain)===sign);
    if (!block.length) continue;
    const sorted = block.map(f=>f.netGain).sort((a,b)=>a-b), n = sorted.length;
    const mid = (sorted[Math.floor(n/2)] + sorted[Math.floor((n-1)/2)])/2;
    const nearest = Math.min(...sorted.map(v=>Math.abs(v-mid)));
    out.push(block.find(f=>Math.abs(f.netGain-mid)===nearest));
  }
  return out;
}
function counts(forks) {
  const deferred = forks.reduce((n,f)=>n+Number(f.chosenId===f.constantId),0);
  return {eligible:forks.length,deferred,switched:forks.length-deferred};
}
for (const [split,families,perFamily,firstSeed,starts,durations] of banks) {
  const bank = await file(split+".json",report.banks[split]);
  assert.equal(bank.suite,report.suite);
  assert.equal(bank.split,split);
  assert.equal(bank.cases.length,perFamily*families.length);
  const result = report.splits[split], rows = [], ledgers = [], forks = [];
  let changed = 0, incidentBoards = 0;
  for (const [i,stored] of bank.cases.entries()) {
    const index = Math.floor(i/perFamily), family=families[index];
    const config = {family,seed:firstSeed+index*10000+i%perFamily,closure:starts ? {starts,durations} : null};
    for (const k of Object.keys(config)) assert.deepEqual(stored[k],config[k]);
    const audited = auditCase(config,stored);
    rows.push({family,duration:stored.duration,agent:stored.rl.ledger,...Object.fromEntries(refs.map(k=>[k,stored[k === "closure" ? "closurePolicy" : k].ledger]))});
    ledgers.push(audited.ledgers);
    forks.push(...audited.forks);
    incidentBoards += audited.incidentBoards;
    changed += Number(stored.rl.actions.some((a,i)=>a!==stored.flatRisk.actions[i]));
  }
  const labels = [...new Set(rows.map(r=>r.duration))].sort();
  assert.deepEqual(result.diagnostics,{...counts(forks),incidentBoards,weeksChanged:changed,forked:forks.length,
    byDuration:Object.fromEntries(labels.map(d=>[d,counts(forks.filter(f=>f.duration===d))]))});
  assert.deepEqual(result.examples,medianForks(forks));
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
  for (const [i,fit] of result.fits.entries()) assert.deepEqual(fit.flatRisk,paired(rows.map((r,j)=>({...r,agent:ledgers[j][i]})),"flatRisk"));
  console.log("Audited",split,rows.length,"weeks,",10*rows.length,"complete trajectories and",forks.length,"forks.");
}
const all = report.splits.test.summary.all, doubleReturn = report.splits.archive.summary.all.earnsMoreThanPlanner;
assert.deepEqual(report.goals,{freshProfit:all.earnsMoreThanPlanner,freshService:all.matchesPlannerService,
  freshFlatProfit:all.earnsMoreThanFlatRisk,freshFlatService:all.matchesFlatRiskService,doubleReturn,
  joint:all.beatsPlanner && all.beatsFlatRisk && doubleReturn});
