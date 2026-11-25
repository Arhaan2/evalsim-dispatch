// Rebuild all Friday ledgers and score intervals independently of the release scorer.
// Review only calls the preceding policy would actually make from this truck placement.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeFleetPolicy} from "../../docs/lib/fleetweek-policy.js";
import {makeOvernightPolicy} from "../../docs/lib/overnight-policy.js";
import {makeOverridePolicy} from "../../docs/lib/override-policy.js";
import {inspectUncertainty, makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {publicFrames, replay} from "../fleetweek/audit-helpers.mjs";
import {verifyFleetSplit} from "../fleetweek/verify-split.mjs";

const root = new URL("../../docs/data/uncertainty/", import.meta.url);
const referenceKeys = ["rl","planner","override","meanOnly","flatRisk","overnight","previous"];
const fitSeeds = [13,37,73,101,211];
const manifests = [
  ["validation",350000000,128,["short-week-loop","midweek-relay"]],
  ["test",360000000,2048,["switchback-home","late-double-loop","closing-relay","midweek-feint"]],
  ["archive",370000000,4096,["double-return"]],
];

async function artifact(name, digest) {
  const bytes=await readFile(new URL(name,root));
  if (digest !== undefined) {
    assert.match(digest,/^[a-f0-9]{64}$/);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest,name);
  }
  return JSON.parse(bytes);
}

function close(observed, expected) {
  if (expected === null) return assert.equal(observed,null);
  assert(Number.isFinite(observed) && Math.abs(observed-expected) < 1e-9, observed+" differs from "+expected);
}

function fork(frames, prefix, first, policy) {
  const actions=[];
  const ledger=replay(frames,(board,legal)=>{
    const t=board.epoch;
    const id=t<prefix.length ? prefix[t] : t===prefix.length ? first : policy(board,legal);
    actions.push(id);
    return id;
  });
  return {ledger,actions};
}

const results=await artifact("results.json");
assert.equal(results.suite,"dispatch-uncertainty-v1");
assert.equal(results.primarySeed,13);
assert.deepEqual(results.fitSeeds,fitSeeds);
const weights=await Promise.all(fitSeeds.map(seed=>artifact("model-"+seed+".json",results.weightHashes[seed])));
const model=weights[0];
const predecessor=await artifact("../override/model-13.json",results.overrideHash);
const policies={
  rl:makeUncertaintyPolicy(model,predecessor), planner:chooseFleetPlanner, override:makeOverridePolicy(predecessor),
  meanOnly:makeUncertaintyPolicy(model,predecessor,{meanOnly:true}),
  flatRisk:makeUncertaintyPolicy(model,predecessor,{flatRisk:true}),
  overnight:makeOvernightPolicy(await artifact("../overnight/model-13.json",results.overnightHash)),
  previous:makeFleetPolicy(await artifact("../fleetweek/model-13.json",results.previousHash)),
};
const replicates=weights.slice(1).map(m=>makeUncertaintyPolicy(m,predecessor));

function checkWeek(row) {
  const frames=publicFrames(row);
  const calls=[];
  const primary=replay(frames,(obs,legal)=>{
    const plan=policies.planner(obs,legal), proposal=policies.override(obs,legal);
    const detail=inspectUncertainty(obs,legal,model,predecessor);
    assert.equal(plan,detail.plannerId);
    if (proposal===plan) {
      assert.equal(detail.proposalId,null);
      assert.equal(detail.chosenId,plan);
    } else {
      assert([1,3,5,7].includes(obs.epoch));
      assert.equal(detail.proposalId,proposal);
      const bookings=id=>id.split("|").map(s=>/^(W|E[012])$/.test(s)?"empty":s);
      assert.deepEqual(bookings(plan),bookings(proposal));
      const m=model.settings;
      const value=detail.netGain+m.serviceCredit*detail.serviceGain;
      close(detail.penalty,m.lambda*detail.downside);
      close(detail.score,value-detail.penalty);
      assert(detail.downside>=0);
      const chosen=!m.plannerOnly && value-detail.penalty>0 ? proposal : plan;
      assert.equal(detail.chosenId,chosen);
      const meanOnlyId=!m.plannerOnly && value>0 ? proposal : plan;
      const flatRiskId=!m.plannerOnly && value-m.lambda*model.flatDownside>0 ? proposal : plan;
      assert.equal(detail.riskVeto,chosen===plan && meanOnlyId===proposal);
      calls.push({t:obs.epoch,plan,proposal,chosen,detail,meanOnlyId,flatRiskId});
    }
    return detail.chosenId;
  },row.rl);
  const scores={family:row.family,agent:primary,rl:primary};
  for (const key of referenceKeys.slice(1)) scores[key]=replay(frames,policies[key],row[key]);
  const fitted=[primary,...replicates.map(policy=>replay(frames,policy))];
  assert.equal(calls.length,row.branches.length);
  const decisions=calls.map((call,index)=>{
    const {t,plan,proposal,chosen,detail,meanOnlyId,flatRiskId}=call;
    const prefix=row.rl.actions.slice(0,t);
    const accepted=chosen===proposal;
    const opposite=accepted ? plan : proposal;
    const other=fork(frames,prefix,opposite,policies.rl);
    const priorGain=fork(frames,prefix,proposal,policies.override).ledger.net -
      fork(frames,prefix,plan,policies.override).ledger.net;
    const estimates={};
    for (const key of ["priorNetGain","riskMean","netGain","serviceGain","downside","penalty","score","riskVeto"]) estimates[key]=detail[key];
    Object.assign(estimates,{meanOnlyId,flatRiskId});
    assert.deepEqual(row.branches[index],[t,plan,proposal,other.actions.slice(t),
      other.ledger.net,other.ledger.served,priorGain,estimates]);
    const netGain=primary.net-other.ledger.net;
    return {...call,row,opposite,other,accepted,estimates,priorGain,netGain,serviceGain:primary.served-other.ledger.served,
      proposalLost:(accepted ? netGain : -netGain)<0, observedDownside:Math.max(0,detail.riskMean-priorGain)};
  });
  return {scores,fitted,decisions};
}

function verifyDiagnostics(rows,d,weekCount) {
  assert.equal(d.nights,weekCount*4);
  assert.equal(d.eligible,rows.length);
  assert.equal(d.meanOnlyChanges,rows.filter(r=>r.meanOnlyId!==r.chosen).length);
  assert.equal(d.flatRiskChanges,rows.filter(r=>r.flatRiskId!==r.chosen).length);
  assert.deepEqual(d.riskCuts,model.riskCuts);
  const cuts=d.riskCuts;
  assert(cuts.length===2 && cuts[0]<=cuts[1]);
  const mean=(rs,read)=>rs.length ? rs.reduce((s,r)=>s+read(r),0)/rs.length : null;
  assert.deepEqual(d.riskBands.map(b=>b.name),["low","middle","high"]);
  for(const [i,band] of d.riskBands.entries()) {
    const group=rows.filter(r=>(r.detail.downside<=cuts[0] ? 0 : r.detail.downside<=cuts[1] ? 1 : 2)===i);
    assert.equal(band.nights,group.length);
    assert.equal(band.accepted,group.filter(r=>r.accepted).length);
    assert.equal(band.deferred,group.filter(r=>!r.accepted).length);
    assert.equal(band.proposalLosses,group.filter(r=>r.proposalLost).length);
    close(band.meanPredictedDownside,mean(group,r=>r.detail.downside));
    close(band.meanObservedDownside,mean(group,r=>r.observedDownside));
    close(band.lossRate,mean(group,r=>Number(r.proposalLost)));
  }
  const examples=[];
  for (const accepted of [true,false]) {
    const name=accepted?"accept":"decline";
    const group=rows.filter(r=>r.accepted===accepted);
    assert.deepEqual(d[name],{nights:group.length,helped:group.filter(r=>r.netGain>0).length,
      tied:group.filter(r=>r.netGain===0).length,hurt:group.filter(r=>r.netGain<0).length,
      netGain:group.reduce((s,r)=>s+r.netGain,0),serviceGain:group.reduce((s,r)=>s+r.serviceGain,0)});
    for (const sign of [1,-1]) {
      const bucket=group.filter(r=>Math.sign(r.netGain)===sign);
      if (!bucket.length) continue;
      const sorted=bucket.map(r=>r.netGain).sort((a,b)=>a-b);
      const median=(sorted[(sorted.length-1)>>1]+sorted[sorted.length>>1])/2;
      const distance=Math.min(...sorted.map(x=>Math.abs(x-median)));
      const r=bucket.find(x=>Math.abs(x.netGain-median)===distance);
      examples.push({family:r.row.family,seed:r.row.seed,epoch:r.t,choice:name,
        plannerId:r.plan,proposalId:r.proposal,estimates:r.estimates,chosenId:r.chosen,alternativeId:r.opposite,
        prefix:r.row.rl.actions.slice(0,r.t),chosen:r.row.rl,alternative:r.other,netGain:r.netGain,serviceGain:r.serviceGain,priorContinuationNetDifference:r.priorGain});
    }
  }
  assert.deepEqual(d.examples,examples);
}
for (const [split,start,count,families] of manifests) {
  const bank=await artifact(split+".json",results.banks[split]);
  assert.equal(bank.suite,results.suite);
  assert.equal(bank.split,split);
  assert.equal(bank.cases.length,count*families.length);
  const rows=[],fits=[],calls=[];
  for(const [i,row] of bank.cases.entries()) {
    const familyIndex=Math.floor(i/count);
    assert.equal(row.family,families[familyIndex]);
    assert.equal(row.seed,start+10000*familyIndex+i%count);
    const check=checkWeek(row);
    rows.push(check.scores);fits.push(check.fitted);calls.push(...check.decisions);
  }
  const report=results.splits[split];
  verifyFleetSplit(rows,fits,report,referenceKeys,families,fitSeeds);
  verifyDiagnostics(calls,report.diagnostics,rows.length);
  console.log("Verified",split,rows.length,"weeks with 11 complete policies and",calls.length,"matched override decisions.");
}
const fresh=results.splits.test.summary.all, archive=results.splits.archive.summary.all;
assert.deepEqual(results.goals,{freshProfit:fresh.earnsMoreThanPlanner,freshService:fresh.matchesPlannerService,
  doubleReturn:archive.earnsMoreThanPlanner,joint:fresh.beatsPlanner && archive.earnsMoreThanPlanner});
