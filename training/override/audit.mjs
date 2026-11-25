// Reconstruct the named trucks' moves and invoices from public freight boards.
// The public runner and its scored summaries are not used for this check.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {chooseFleetGreedy, chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeFleetPolicy} from "../../docs/lib/fleetweek-policy.js";
import {makeOvernightPolicy} from "../../docs/lib/overnight-policy.js";
import {inspectOverride, makeOverridePolicy} from "../../docs/lib/override-policy.js";
import {verifyFleetSplit} from "../fleetweek/verify-split.mjs";
import {publicFrames, replay} from "../fleetweek/audit-helpers.mjs";

const data = new URL("../../docs/data/override/", import.meta.url);
const references = ["rl", "planner", "overnight", "previous", "always", "greedy"];
const seeds = [13, 37, 73, 101, 211];
const manifest = [
  ["validation", 250000000, 128, ["split-relay", "delayed-loop"]],
  ["test", 260000000, 1024, ["staggered-return", "second-return", "friday-detour", "relay-backtrack"]],
  ["archive", 270000000, 2048, ["double-return"]],
];

async function read(name, digest) {
  const bytes = await readFile(new URL(name,data));
  if (digest !== undefined) {
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, name);
  }
  return JSON.parse(bytes);
}

function freight(id) {
  return id.split("|").map(code => /^(W|E[0-2])$/.test(code) ? "_" : code).join("|");
}

function verifyWeek(row, models, policies) {
  const frames = publicFrames(row);
  const calls = [];
  const decide = (obs,menu) => {
    const detail = inspectOverride(obs,menu,models[0]);
    const planner = chooseFleetPlanner(obs,menu);
    assert.equal(detail.plannerId, planner);
    const selected = policies.rl(obs,menu);
    const eligible = [1,3,5,7].includes(obs.epoch) && freight(planner).includes("_");
    assert.equal(detail.proposalId != null, eligible);
    if (eligible) {
      assert.notEqual(detail.proposalId, planner);
      assert.equal(freight(detail.proposalId), freight(planner));
      assert(menu.some(action => action.id === detail.proposalId));
      assert(selected === planner || selected === detail.proposalId);
      calls.push({epoch:obs.epoch, planner, proposal:detail.proposalId, selected, detail});
    } else {
      assert.equal(selected, planner);
    }
    return selected;
  };
  const observed = {family:row.family, agent:replay(frames,decide,row.rl)};
  observed.rl = observed.agent;
  for (const key of references.slice(1)) observed[key] = replay(frames,policies[key],row[key]);
  const fits = [observed.agent, ...policies.replicates.map(policy => replay(frames,policy))];
  assert.equal(row.branches.length, calls.length);
  const decisions = calls.map(({epoch,planner,proposal,selected,detail},idx) => {
    const accepted = selected === proposal;
    const alternative = accepted ? planner : proposal;
    const actions = [];
    const ledger = replay(frames,(obs,menu) => {
      const id = obs.epoch < epoch ? row.rl.actions[obs.epoch] :
        obs.epoch === epoch ? alternative : policies.rl(obs,menu);
      actions.push(id);
      return id;
    });
    assert.deepEqual(row.branches[idx], [epoch,planner,proposal,actions.slice(epoch),ledger.net,ledger.served]);
    return {row,epoch,planner,proposal,selected,detail,alternative,actions,ledger,accepted,
      netGain:observed.agent.net-ledger.net, serviceGain:observed.agent.served-ledger.served};
  });
  return {observed, fits, decisions};
}

function verifyDiagnostics(records, report, count) {
  assert.equal(report.nights, count*4);
  assert.equal(report.eligible, records.length);
  const examples = [];
  for (const accept of [true,false]) {
    const group = records.filter(r => r.accepted === accept);
    const key = accept ? "accept" : "decline";
    assert.deepEqual(report[key], {nights:group.length,helped:group.filter(r=>r.netGain>0).length,
      tied:group.filter(r=>r.netGain===0).length,hurt:group.filter(r=>r.netGain<0).length,
      netGain:group.reduce((s,r)=>s+r.netGain,0),serviceGain:group.reduce((s,r)=>s+r.serviceGain,0)});
    for (const sign of [1,-1]) {
      const bucket = group.filter(r => Math.sign(r.netGain) === sign);
      if (!bucket.length) continue;
      const sorted = bucket.map(r=>r.netGain).sort((a,b)=>a-b);
      const median = (sorted[(sorted.length-1)>>1]+sorted[sorted.length>>1])/2;
      const best = Math.min(...sorted.map(value=>Math.abs(value-median)));
      const r = bucket.find(x=>Math.abs(x.netGain-median)===best);
      examples.push(r);
    }
  }
  assert.equal(report.examples.length, examples.length);
  for (const [i,r] of examples.entries()) {
    const e = report.examples[i];
    assert.deepEqual([e.family,e.seed,e.epoch,e.choice,e.plannerId,e.proposalId,e.chosenId,e.alternativeId],
      [r.row.family,r.row.seed,r.epoch,r.accepted?"accept":"decline",r.planner,r.proposal,r.selected,r.alternative]);
    assert.deepEqual(e.prefix, r.row.rl.actions.slice(0,r.epoch));
    assert.deepEqual(e.chosen, r.row.rl);
    assert.deepEqual(e.alternative, {actions:r.actions,ledger:r.ledger});
    assert.deepEqual([e.netGain,e.serviceGain],[r.netGain,r.serviceGain]);
    for (const name of ["netGain","serviceGain","score","threshold"]) assert.equal(e.estimates[name],r.detail[name]);
  }
}

const results = await read("results.json");
assert.equal(results.suite, "dispatch-override-v1");
assert.equal(results.primarySeed,13);
assert.deepEqual(results.fitSeeds,seeds);
const models = await Promise.all(seeds.map(seed=>read("model-"+seed+".json",results.weightHashes[seed])));
const policies = {
  rl:makeOverridePolicy(models[0]), planner:chooseFleetPlanner, greedy:chooseFleetGreedy,
  overnight:makeOvernightPolicy(await read("../overnight/model-13.json",results.overnightHash)),
  previous:makeFleetPolicy(await read("../fleetweek/model-13.json",results.previousHash)),
  always:(obs,menu)=> {
    const decision=inspectOverride(obs,menu,models[0]);
    return decision.proposalId ?? decision.plannerId;
  },
  replicates:models.slice(1).map(checkpoint=>makeOverridePolicy(checkpoint)),
};

for (const [split,start,n,families] of manifest) {
  const bank = await read(split+".json",results.banks[split]);
  assert.equal(bank.suite,results.suite);
  assert.equal(bank.split,split);
  assert.equal(bank.cases.length,n*families.length);
  const rows=[], allFits=[], decisions=[];
  for (const [i,row] of bank.cases.entries()) {
    const family=Math.floor(i/n);
    assert.equal(row.family,families[family]);
    assert.equal(row.seed,start+10000*family+i%n);
    const checks=verifyWeek(row,models,policies);
    rows.push(checks.observed);
    allFits.push(checks.fits);
    decisions.push(...checks.decisions);
  }
  const {diagnostics}=results.splits[split];
  verifyFleetSplit(rows,allFits,results.splits[split],references,families,seeds);
  verifyDiagnostics(decisions,diagnostics,rows.length);
  console.log("Verified",split,rows.length,"weeks, ten policies per week and",decisions.length,"matched decisions.");
}
const fresh=results.splits.test.summary.all, archive=results.splits.archive.summary.all;
assert.deepEqual(results.goals,{freshProfit:fresh.earnsMoreThanPlanner,freshService:fresh.matchesPlannerService,
  doubleReturn:archive.earnsMoreThanPlanner,joint:fresh.beatsPlanner && archive.earnsMoreThanPlanner});
