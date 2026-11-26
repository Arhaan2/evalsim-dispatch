// Reconstruct ledgers, eligibility, both branches and paired intervals separately
// from the scorer. Replay accounts for each signed load, missed contract and mile.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fleetPairIndex} from "../../docs/lib/fleetweek.js";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {closureFrames} from "../../docs/lib/closure-world.js";
import {chooseClosurePlanner,makeClosureFlatRisk} from "../../docs/lib/closure-planner.js";
import {inspectClosure,makeClosurePolicy} from "../../docs/lib/closure-policy.js";
import {paired,publicFrames,replay} from "../fleetweek/audit-helpers.mjs";
import {checkNotices,openMoves} from "../fleetweek/audit-closures.mjs";
import {verifyFleetSplit} from "../fleetweek/verify-split.mjs";

const data=new URL("../../docs/data/closure/",import.meta.url);
async function file(name,digest) {
  const bytes=await readFile(new URL(name,data));
  if (digest) assert.equal(createHash("sha256").update(bytes).digest("hex"),digest,name);
  return JSON.parse(bytes);
}
const registered=[13,37,73,101,211], references=["rl","planner","flatRisk"];
const fresh=["repair-crossing","repair-midweek-loop","repair-late-relay","repair-last-return"];
const schedules=[
  ["validation",["repair-transfer","repair-home-run"],128,550000000,[1,7],[[1,2,4],[2,3,5]]],
  ["test",fresh,2048,560000000,[3,5],[[1,2,4],[2,3,5],[1,4,5],[2,4,5]]],
  ["clean",fresh,512,570000000,null,null],
  ["archive",["double-return"],4096,580000000,null,null]
];
const results=await file("results.json");
assert.equal(results.suite,"dispatch-closure-v1");
assert.deepEqual(results.fitSeeds,registered);
assert.equal(results.primarySeed,13);
const overrideHash="f70b76a430aadf6c0050a2041208d8fc549c0767b98291574971b681e16a05f9";
const uncertaintyHash="dec9377b49db274f14f0509e5f07d55e3aa2c1ed69a106dccf330fcc82e3fd3c";
assert.equal(results.overrideHash,overrideHash);
assert.equal(results.uncertaintyHash,uncertaintyHash);
const weights={
  override:await file("../override/model-13.json",overrideHash),
  uncertainty:await file("../uncertainty/model-13.json",uncertaintyHash)
};
const fits=await Promise.all(registered.map(seed=>file("model-"+seed+".json",results.weightHashes[seed])));
for (const [i,m] of fits.entries()) assert.equal(m.seed,registered[i]);
const release=makeClosurePolicy(fits[0],weights);
const flatRisk=makeClosureFlatRisk(weights);
const prior=makeUncertaintyPolicy(weights.uncertainty,weights.override,{flatRisk:true});
const replicates=fits.slice(1).map(m=>makeClosurePolicy(m,weights));

function sameSignedWork(a,b) {
  const normalize=move=>move[0]==="E" || move==="W" ? null : move;
  return a.moves.every((m,i)=>normalize(m)===normalize(b.moves[i]));
}

function auditWeek(config,stored,familyIndex,diagnostics,examples) {
  const frames=closureFrames(config),original=publicFrames(config);
  checkNotices(frames,original,config.closure);
  const cache=new Map(), decisions=[];
  function trace(dispatch,record) {
    const actions=[];
    const ledger=replay(frames,(obs,all)=>{
      const [a,b]=obs.positions, key=obs.epoch*9+a*3+b;
      if(!cache.has(key)) cache.set(key,{obs,legal:openMoves(obs,all)});
      const board=cache.get(key);
      const id=dispatch(board.obs,board.legal);
      assert(board.legal.some(move=>move.id===id),"Action violates depot availability");
      actions.push(id);
      return id;
    },record);
    return {actions,ledger};
  }
  const primary=trace((obs,legal)=>{
    const d=inspectClosure(obs,legal,fits[0],weights);
    const plan=chooseClosurePlanner(obs,legal),constant=flatRisk(obs,legal);
    assert.equal(d.plannerId,plan);
    assert.equal(d.constantId,constant);
    const incumbent=legal.find(a=>a.id===constant);
    const status=obs.incident.status,t=obs.epoch;
    const active=status==="closed"||status==="warning";
    if (active) diagnostics.incidentBoards++;
    const alternatives=active && t<9 ? legal.filter(a=>sameSignedWork(a,incumbent) &&
      fleetPairIndex(a.positions)!==fleetPairIndex(incumbent.positions)) : [];
    assert.equal(d.eligible,alternatives.length>0);
    if (!alternatives.length) {
      assert.equal(d.proposalId,null);
      assert.equal(d.chosenId,constant);
      return constant;
    }
    diagnostics.eligible++;
    assert(alternatives.some(a=>a.id===d.proposalId));
    const switched=!fits[0].settings.constantOnly && d.proposalScore>fits[0].settings.hurdle;
    assert.equal(d.chosenId,switched ? d.proposalId : constant);
    diagnostics.switched+=Number(switched);
    if(familyIndex<32) decisions.push({epoch:t,status,plannerId:plan,constantId:constant,
      proposalId:d.proposalId,chosenId:d.chosenId,alternativeId:switched?constant:d.proposalId});
    return d.chosenId;
  },stored.rl);
  const planner=trace(chooseClosurePlanner,stored.planner);
  const flat=trace(flatRisk,stored.flatRisk);
  const fitLedgers=[primary.ledger,...replicates.map(policy=>trace(policy).ledger)];
  diagnostics.weeksChanged+=Number(primary.actions.some((id,i)=>id!==flat.actions[i]));
  if (config.closure===null) {
    // These use the original environment and history-only released policies.
    assert.deepEqual(fitLedgers,registered.map(()=>flat.ledger));
    assert.deepEqual(primary,flat);
    replay(original,chooseFleetPlanner,planner);
    replay(original,prior,flat);
  }
  for(const decision of decisions) {
    const alt=trace((o,menu)=>o.epoch<decision.epoch ? primary.actions[o.epoch] :
      o.epoch===decision.epoch ? decision.alternativeId : release(o,menu));
    assert.deepEqual(primary.actions.slice(0,decision.epoch),alt.actions.slice(0,decision.epoch));
    diagnostics.forked++;
    examples.push({...config,...decision,chosen:primary,alternative:alt,
      netGain:primary.ledger.net-alt.ledger.net,serviceGain:primary.ledger.served-alt.ledger.served});
  }
  return {scores:{family:config.family,agent:primary.ledger,rl:primary.ledger,planner:planner.ledger,flatRisk:flat.ledger},fitLedgers};
}

function medianCases(examples) {
  const out=[];
  for (const status of ["closed","warning"]) for (const sign of [1,-1]) {
    const bucket=examples.filter(e=>e.status===status && Math.sign(e.netGain)===sign);
    if(!bucket.length) continue;
    const values=bucket.map(e=>e.netGain).sort((a,b)=>a-b);
    const mid=(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;
    const distance=Math.min(...values.map(v=>Math.abs(v-mid)));
    out.push(bucket.find(item=>Math.abs(item.netGain-mid)===distance));
  }
  return out.length ? out : examples.slice(0,1);
}
for (const [split,families,count,start,starts,durations] of schedules) {
  const bank=await file(split+".json",results.banks[split]);
  assert.equal(bank.suite,results.suite);
  assert.equal(bank.split,split);
  assert.equal(bank.cases.length,count*families.length);
  const rows=[],replicates=[],examples=[];
  const diag={incidentBoards:0,eligible:0,switched:0,weeksChanged:0,forked:0};
  for (const [i,stored] of bank.cases.entries()) {
    const f=Math.floor(i/count);
    const config={family:families[f],seed:start+f*10000+(i%count),closure:starts ? {starts,durations:durations[f]} : null};
    for (const k of Object.keys(config)) assert.deepEqual(stored[k],config[k]);
    const checked=auditWeek(config,stored,i%count,diag,examples);
    rows.push(checked.scores);
    replicates.push(checked.fitLedgers);
  }
  const report=results.splits[split];
  assert.deepEqual(report.diagnostics,diag);
  assert.deepEqual(report.examples,medianCases(examples));
  verifyFleetSplit(rows,replicates,report,references,families,registered);
  for (const group of [report.summary.all,...Object.values(report.summary.byFamily)]) {
    const c=group.comparisons.flatRisk;
    assert.equal(group.earnsMoreThanFlatRisk,c.net95[0]>0);
    assert.equal(group.matchesFlatRiskService,c.servicePP>=0 && c.service95[0]>=0);
    assert.equal(group.beatsFlatRisk,group.earnsMoreThanFlatRisk && group.matchesFlatRiskService);
  }
  for (const name of references) {
    assert.deepEqual(report.versusFlatRisk[name],paired(rows.map(r=>({...r,agent:r[name]})),"flatRisk"));
  }
  for (const [k,fit] of report.fits.entries()) {
    assert.deepEqual(fit.flatRisk,paired(rows.map((r,i)=>({...r,agent:replicates[i][k]})),"flatRisk"));
  }
  console.log("Audited",split,rows.length,"weeks,",7*rows.length,"complete dispatch trajectories,",diag.forked,"replay forks.");
}
const freshGoal=results.splits.test.summary.all, retained=results.splits.archive.summary.all.earnsMoreThanPlanner;
assert.deepEqual(results.goals,{freshProfit:freshGoal.earnsMoreThanPlanner,freshService:freshGoal.matchesPlannerService,
  freshFlatProfit:freshGoal.earnsMoreThanFlatRisk,freshFlatService:freshGoal.matchesFlatRiskService,
  doubleReturn:retained,joint:retained && freshGoal.beatsPlanner && freshGoal.beatsFlatRisk});
