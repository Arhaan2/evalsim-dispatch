// Rebuild each policy's truck locations, costs and weekly returns separately from the scorer.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeFleetPolicy} from "../../docs/lib/fleetweek-policy.js";
import {makeOverridePolicy} from "../../docs/lib/override-policy.js";
import {makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {inspectLoss, makeLossPolicy} from "../../docs/lib/loss-policy.js";
import {paired, publicFrames, replay} from "../fleetweek/audit-helpers.mjs";
import {verifyFleetSplit} from "../fleetweek/verify-split.mjs";

const dir = new URL("../../docs/data/loss/",import.meta.url);
const seeds = [13,37,73,101,211];
const manifests = [
  ["validation",450000000,128,["loss-early-relay","loss-home-relay"]],
  ["test",460000000,2048,["loss-return-bridge","loss-long-relay","loss-market-rebound","loss-split-homecoming"]],
  ["archive",470000000,4096,["double-return"]],
];
async function artifact(name, digest) {
  const bytes = await readFile(new URL(name,dir));
  if (digest !== undefined) assert.equal(createHash("sha256").update(bytes).digest("hex"),digest,name);
  return JSON.parse(bytes);
}
function close(observed, expected) {
  if (expected === null) return assert.equal(observed,null);
  assert(Number.isFinite(observed) && Math.abs(observed-expected)<1e-9, observed+" differs from "+expected);
}
const results = await artifact("results.json");
assert.equal(results.suite,"dispatch-loss-v1");
assert.deepEqual(results.fitSeeds,seeds);
assert.equal(results.primarySeed,13);
const fixed = {
  override: "f70b76a430aadf6c0050a2041208d8fc549c0767b98291574971b681e16a05f9",
  uncertainty: "dec9377b49db274f14f0509e5f07d55e3aa2c1ed69a106dccf330fcc82e3fd3c",
  fleetweek: "4d6998c6b557986759976cbbbd56527b9cb185c940c7ecdf6fa9bdf812774f22",
};
const [prior, oldRisk, original] = await Promise.all(Object.entries(fixed).map(([name,digest])=>{
  assert.equal(results[(name === "fleetweek" ? "previous" : name)+"Hash"],digest);
  return artifact("../"+name+"/model-13.json",digest);
}));
const models = await Promise.all(seeds.map(seed=>artifact("model-"+seed+".json",results.weightHashes[seed])));
for (const [i,m] of models.entries()) assert.equal(m.seed,seeds[i]);
const model = models[0];
const policies = {
  rl: makeLossPolicy(model,prior,oldRisk), planner: chooseFleetPlanner,
  flatRisk: makeUncertaintyPolicy(oldRisk,prior,{flatRisk:true}),
  constantLoss: makeLossPolicy(model,prior,oldRisk,{flatLoss:true}),
  uncertainty: makeUncertaintyPolicy(oldRisk,prior), override: makeOverridePolicy(prior),
  previous: makeFleetPolicy(original),
};
const references = Object.keys(policies);
const secondary = models.slice(1).map(m=>makeLossPolicy(m,prior,oldRisk));

function fork(frames, prefix, first, follow) {
  const actions = [];
  const ledger = replay(frames,(board,legal)=>{
    const t=board.epoch;
    const action=t<prefix.length ? prefix[t] : t===prefix.length ? first : follow(board,legal);
    actions.push(action);
    return action;
  });
  return {actions,ledger};
}
const signedFreight = id=>id.split("|").map(move=>/^(W|E[012])$/.test(move) ? null : move);
function checkWeek(row) {
  const frames=publicFrames(row), opportunities=[];
  const primary=replay(frames,(board,legal)=>{
    const detail=inspectLoss(board,legal,model,prior,oldRisk);
    const plan=policies.planner(board,legal), proposal=policies.override(board,legal);
    assert.equal(detail.plannerId,plan);
    if (plan===proposal) {
      assert.equal(detail.proposalId,null);
      assert.equal(detail.chosenId,plan);
    } else {
      assert([1,3,5,7].includes(board.epoch));
      assert.deepEqual(signedFreight(plan),signedFreight(proposal));
      assert.equal(detail.proposalId,proposal);
      const p=detail.lossProbability;
      assert(p>=0 && p<=1);
      close(detail.usedProbability,p);
      const value=q=>(1-q)*detail.nonLossGain-q*detail.lossSize;
      close(detail.expectedNet,value(p));
      const flatDetail=inspectLoss(board,legal,model,prior,oldRisk,{flatLoss:true});
      close(flatDetail.usedProbability,model.globalLossRate);
      close(flatDetail.score,detail.flatScore);
      close(detail.score-flatDetail.score,model.settings.blend*(value(p)-value(model.globalLossRate)));
      assert.equal(detail.chosenId,!model.settings.plannerOnly && detail.score>0 ? proposal : plan);
      opportunities.push({t:board.epoch,plan,proposal,detail,
        flatRiskId:policies.flatRisk(board,legal),constantLossId:flatDetail.chosenId});
    }
    return detail.chosenId;
  },row.rl);
  const scores={family:row.family,agent:primary,rl:primary};
  for (const k of references.slice(1)) scores[k]=replay(frames,policies[k],row[k]);
  const fits=[primary,...secondary.map(policy=>replay(frames,policy))];
  assert.equal(row.branches.length,opportunities.length);
  const decisions=opportunities.map((o,i)=>{
    const {t,plan,proposal,detail}=o;
    const prefix=row.rl.actions.slice(0,t),chosen=detail.chosenId;
    const alternative=chosen===plan ? proposal : plan;
    const other=fork(frames,prefix,alternative,policies.rl);
    const target=fork(frames,prefix,proposal,policies.flatRisk).ledger.net -
      fork(frames,prefix,plan,policies.flatRisk).ledger.net;
    const stored=row.branches[i];
    assert.deepEqual(stored.slice(0,7),[t,plan,proposal,other.actions.slice(t),other.ledger.net,other.ledger.served,target]);
    const estimates=stored[7];
    assert.deepEqual(Object.keys(estimates).sort(),["lossProbability","usedProbability","rawProbability","lossSize",
      "nonLossGain","expectedNet","serviceGain","score","flatScore","constantLossId","flatRiskId"].sort());
    for (const [key,actual] of Object.entries(estimates)) {
      const expected=Object.hasOwn(detail,key) ? detail[key] : o[key];
      assert.notEqual(expected,undefined,key);
      assert.equal(actual,expected,key);
    }
    return {...o,row,prefix,chosen,alternative,other,target,estimates,accepted:chosen===proposal,
      p:detail.lossProbability,net:primary.net-other.ledger.net,service:primary.served-other.ledger.served};
  });
  return {scores,fits,decisions};
}

function checkStatistics(rows,fits,report,families) {
  verifyFleetSplit(rows,fits,report,references,families,seeds);
  const all=report.summary.all;
  for (const group of [all,...Object.values(report.summary.byFamily)]) {
    const delta=group.comparisons.flatRisk;
    assert.equal(group.earnsMoreThanFlatRisk,delta.net95[0]>0);
    assert.equal(group.matchesFlatRiskService,delta.servicePP>=0 && delta.service95[0]>=0);
    assert.equal(group.beatsFlatRisk,group.earnsMoreThanFlatRisk && group.matchesFlatRiskService);
  }
  for (const name of references) {
    assert.deepEqual(report.versusFlatRisk[name],paired(rows.map(r=>({...r,agent:r[name]})),"flatRisk"));
  }
  for (const [i,fit] of report.fits.entries()) {
    assert.deepEqual(fit.flatRisk,paired(rows.map((r,j)=>({...r,agent:fits[j][i]})),"flatRisk"));
  }
}

const mean=(rows,fn)=>rows.length ? rows.reduce((sum,r)=>sum+fn(r),0)/rows.length : null;
function classification(rows,c) {
  const losses=rows.filter(r=>r.target<0), others=rows.filter(r=>r.target>=0);
  assert.equal(c.n,rows.length);
  assert.equal(c.losses,losses.length);
  assert.equal(c.ties,rows.filter(r=>r.target===0).length);
  close(c.prevalence,mean(rows,r=>Number(r.target<0)));
  close(c.meanPredicted,mean(rows,r=>r.p));
  close(c.constantProbability,model.globalLossRate);
  close(c.brier,mean(rows,r=>(r.p-Number(r.target<0))**2));
  close(c.constantBrier,mean(rows,r=>(model.globalLossRate-Number(r.target<0))**2));
  let correctlyRanked=0;
  for (const loss of losses) for (const other of others) {
    correctlyRanked+=loss.p>other.p ? 1 : Number(loss.p===other.p)/2;
  }
  close(c.auc,losses.length && others.length ? correctlyRanked/(losses.length*others.length) : null);
  assert.equal(c.bins.length,5);
  for (const [i,b] of c.bins.entries()) {
    const group=rows.filter(r=>Math.min(4,Math.floor(r.p*5))===i);
    checkBin(b,group,i);
  }
}
function checkBin(bin,group,i) {
  assert.equal(bin.lower,i/5);
  assert.equal(bin.upper,(i+1)/5);
  assert.equal(bin.n,group.length);
  assert.equal(bin.losses,group.filter(r=>r.target<0).length);
  close(bin.meanPredicted,mean(group,r=>r.p));
  close(bin.lossRate,mean(group,r=>Number(r.target<0)));
}
function checkDecisions(rows,diagnostics,count) {
  assert.equal(diagnostics.nights,4*count);
  assert.equal(diagnostics.eligible,rows.length);
  assert.equal(diagnostics.flatRiskChanges,rows.filter(r=>r.flatRiskId!==r.chosen).length);
  assert.equal(diagnostics.constantLossChanges,rows.filter(r=>r.constantLossId!==r.chosen).length);
  classification(rows,diagnostics.classifier);
  const examples=[];
  for (const accepted of [true,false]) {
    const choice=accepted ? "accept" : "decline";
    const group=rows.filter(r=>r.accepted===accepted);
    assert.deepEqual(diagnostics[choice],{nights:group.length,helped:group.filter(r=>r.net>0).length,
      tied:group.filter(r=>r.net===0).length,hurt:group.filter(r=>r.net<0).length,
      netGain:group.reduce((s,r)=>s+r.net,0),serviceGain:group.reduce((s,r)=>s+r.service,0)});
    for (const sign of [1,-1]) {
      const bucket=group.filter(r=>Math.sign(r.net)===sign);
      if (!bucket.length) continue;
      const values=bucket.map(r=>r.net).sort((a,b)=>a-b);
      const median=(values[(values.length-1)>>1]+values[values.length>>1])/2;
      const distance=Math.min(...values.map(n=>Math.abs(n-median)));
      const r=bucket.find(r=>Math.abs(r.net-median)===distance);
      examples.push({family:r.row.family,seed:r.row.seed,epoch:r.t,choice,
        plannerId:r.plan,proposalId:r.proposal,estimates:r.estimates,chosenId:r.chosen,alternativeId:r.alternative,
        prefix:r.prefix,chosen:r.row.rl,alternative:r.other,netGain:r.net,serviceGain:r.service,targetNetDifference:r.target});
    }
  }
  assert.deepEqual(diagnostics.examples,examples);
}
for (const [split,start,count,families] of manifests) {
  const bank=await artifact(split+".json",results.banks[split]);
  assert.equal(bank.split,split);
  assert.equal(bank.suite,results.suite);
  assert.equal(bank.cases.length,count*families.length);
  const rows=[], fits=[], decisions=[];
  for (const [i,row] of bank.cases.entries()) {
    const group=Math.floor(i/count);
    assert.equal(row.family,families[group]);
    assert.equal(row.seed,start+group*10000+i%count);
    const checked=checkWeek(row);
    rows.push(checked.scores);
    fits.push(checked.fits);
    decisions.push(...checked.decisions);
  }
  checkStatistics(rows,fits,results.splits[split],families);
  checkDecisions(decisions,results.splits[split].diagnostics,rows.length);
  console.log("Verified",split,rows.length,"weeks, eleven policy trajectories per week and",decisions.length,"paired proposal decisions.");
}
const fresh=results.splits.test.summary.all;
const archive=results.splits.archive.summary.all;
assert.deepEqual(results.goals,{freshProfit:fresh.earnsMoreThanPlanner,freshService:fresh.matchesPlannerService,
  freshFlatProfit:fresh.earnsMoreThanFlatRisk,freshFlatService:fresh.matchesFlatRiskService,
  doubleReturn:archive.earnsMoreThanPlanner,joint:fresh.beatsPlanner && fresh.beatsFlatRisk && archive.earnsMoreThanPlanner});
