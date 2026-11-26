import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {longRepairProposal, longRepairDecision} from "../../docs/lib/longrepair-policy.js";
import {LONGREPAIR_REFERENCES as refs, LONGREPAIR_SPLITS, LONGREPAIR_SUITE, longRepairCases,
  summarizeLongRepair, summarizeDurations} from "../../docs/lib/longrepair-study.js";
import {FIT_SEEDS, DECISION_MS, fleetLedger, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {artifact, hash, legacyCheckpoint} from "../fleetweek/score-helpers.mjs";

const mode = process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write to score or --check to verify.");
const dir = new URL("../../docs/data/longrepair/", import.meta.url);
const weights = {}, hashes = {};
for (const name of ["closure","override","uncertainty"]) {
  const prior = await legacyCheckpoint(dir, name);
  weights[name] = prior.checkpoint;
  hashes[name + "Hash"] = prior.hash;
}
async function fitted(file, seed) {
  const bytes = await readFile(new URL(file, dir));
  const model = JSON.parse(bytes);
  assert.equal(model.seed, seed);
  return {seed, model, sha:hash(bytes)};
}
const fits = await Promise.all(FIT_SEEDS.map(seed => fitted("fit-" + seed + ".json", seed)));
const short = await fitted("short-13.json", 13), primary = fits[0].model;
const results = {suite:LONGREPAIR_SUITE, primarySeed:13, fitSeeds:FIT_SEEDS,
  weightHashes:Object.fromEntries(fits.map(f => [f.seed, f.sha])), shortHash:short.sha, ...hashes, banks:{}, splits:{}};

// The public freight and bulletin history is exogenous. Share only a current-board proposal
// among trajectories that arrive at this epoch with the same two ordered truck locations.
function scoreWeek(config) {
  const cache = new Map();
  function run(choose) {
    const world = createClosureWeek(config), actions = [];
    let duration = 0;
    while (!world.done) {
      const obs = world.observe(), [a,b] = obs.positions, key = obs.epoch * 9 + a * 3 + b;
      duration += Number(obs.incident.status === "closed");
      const start = performance.now();
      if (!cache.has(key)) cache.set(key, longRepairProposal(closureFrame(obs), world.legalActions(), weights));
      const chosen = choose(cache.get(key), obs);
      assert(performance.now() - start <= DECISION_MS, "Dispatch exceeded one second");
      world.step(chosen);
      actions.push(chosen);
    }
    return {duration, path:{actions, ledger:fleetLedger(world.ledger)}};
  }
  const decisions = [];
  let incidentBoards = 0;
  const release = p => longRepairDecision(p, primary).chosenId;
  const {duration, path:rl} = run((p,obs) => {
    const chosenId = release(p), {status} = obs.incident;
    incidentBoards += Number(status === "warning" || status === "closed");
    if (p.eligible) decisions.push({epoch:obs.epoch, status, plannerId:p.plannerId, closureId:p.closureId,
      constantId:p.constantId, chosenId, alternativeId:chosenId === p.constantId ? p.closureId : p.constantId});
    return chosenId;
  });
  const row = {...config, duration, rl, planner:run(p => p.plannerId).path, flatRisk:run(p => p.constantId).path,
    closurePolicy:run(p => p.closureId).path, flatGate:run(p => longRepairDecision(p, primary, {flatGate:true}).chosenId).path,
    shortGate:run(p => longRepairDecision(p, short.model).chosenId).path};
  const forks = decisions.map(d => {
    const other = run((p,o) => o.epoch < d.epoch ? rl.actions[o.epoch] : o.epoch === d.epoch ? d.alternativeId : release(p)).path;
    return {...config, duration, ...d, chosen:rl, alternative:other, netGain:rl.ledger.net - other.ledger.net,
      serviceGain:rl.ledger.served - other.ledger.served};
  });
  const fitLedgers = [rl.ledger, ...fits.slice(1).map(f => run(p => longRepairDecision(p, f.model).chosenId).path.ledger)];
  return {row, forks, fitLedgers, incidentBoards};
}

function representativeForks(examples) {
  const result = [];
  for (const adopt of [true,false]) for (const sign of [1,-1]) {
    const bucket = examples.filter(e => (e.chosenId === e.closureId) === adopt && Math.sign(e.netGain) === sign);
    if (!bucket.length) continue;
    const values = bucket.map(e => e.netGain).sort((a,b) => a-b);
    const median = (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
    result.push(bucket.reduce((a,b) => Math.abs(a.netGain - median) <= Math.abs(b.netGain - median) ? a : b));
  }
  return result;
}
function decisionCounts(forks) {
  const switched = forks.filter(f => f.chosenId === f.closureId).length;
  return {eligible:forks.length, switched, deferred:forks.length - switched};
}
for (const split of LONGREPAIR_SPLITS) {
  const cases = [], rows = [], allFits = [], forks = [];
  let changed = 0, incidentBoards = 0;
  for (const config of longRepairCases(split)) {
    const scored = scoreWeek(config), row = scored.row;
    cases.push(row);
    rows.push({family:config.family, duration:row.duration, agent:row.rl.ledger, ...Object.fromEntries(refs.map(k => [k,row[k === "closure" ? "closurePolicy" : k].ledger]))});
    allFits.push(scored.fitLedgers);
    forks.push(...scored.forks);
    changed += Number(row.rl.actions.some((id,i) => id !== row.flatRisk.actions[i]));
    incidentBoards += scored.incidentBoards;
  }
  results.banks[split] = await artifact(dir, mode, split + ".json", {suite:LONGREPAIR_SUITE, split, cases});
  const summary = summarizeLongRepair(rows);
  const against = key => Object.fromEntries(refs.map(k => [k,k === "rl" ? summary.all.comparisons[key] :
    pairedFleetComparison(rows.map(r => ({...r,agent:r[k]})), key)]));
  const scores = fits.map(({seed},i) => {
    const block = rows.map((r,j) => ({...r,agent:allFits[j][i]}));
    return {seed,net:block.reduce((s,r) => s+r.agent.net,0)/rows.length, onTime:10*(block.reduce((s,r) => s+r.agent.served,0)/rows.length),
      planner:pairedFleetComparison(block,"planner"), flatRisk:pairedFleetComparison(block,"flatRisk")};
  });
  const diagnostics = {incidentBoards, ...decisionCounts(forks), weeksChanged:changed, forked:forks.length,
    byDuration:Object.fromEntries([...new Set(rows.map(r => r.duration))].sort().map(d => [d,decisionCounts(forks.filter(f => f.duration === d))]))};
  results.splits[split] = {summary, ...summarizeDurations(rows), fits:scores, versusPlanner:against("planner"),
    versusFlatRisk:against("flatRisk"), diagnostics, examples:representativeForks(forks)};
  console.log("Scored",split,rows.length,"weeks and",forks.length,"paired disagreement forks.");
}
const fresh = results.splits.test.summary.all, doubleReturn = results.splits.archive.summary.all.earnsMoreThanPlanner;
results.goals = {freshProfit:fresh.earnsMoreThanPlanner, freshService:fresh.matchesPlannerService,
  freshFlatProfit:fresh.earnsMoreThanFlatRisk, freshFlatService:fresh.matchesFlatRiskService, doubleReturn,
  joint:doubleReturn && fresh.beatsPlanner && fresh.beatsFlatRisk};
await artifact(dir, mode, "results.json", results);
