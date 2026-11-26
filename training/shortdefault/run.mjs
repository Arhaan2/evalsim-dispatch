import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {shortDefaultProposal, shortDefaultDecision} from "../../docs/lib/shortdefault-policy.js";
import {SHORTDEFAULT_REFERENCES as refs, SHORTDEFAULT_SPLITS, SHORTDEFAULT_SUITE, shortDefaultCases,
  summarizeShortDefault, summarizeShortDefaultDurations} from "../../docs/lib/shortdefault-study.js";
import {FIT_SEEDS, DECISION_MS, fleetLedger, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {artifact, hash, legacyCheckpoint} from "../fleetweek/score-helpers.mjs";

const mode = process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write to score or --check to verify.");
const dir = new URL("../../docs/data/shortdefault/", import.meta.url);
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
const historic = JSON.parse(await readFile(new URL("../longrepair/results.json",dir)));
for (const [key,file,digest] of [["short","short-13.json",historic.shortHash], ["long","fit-13.json",historic.weightHashes[13]]]) {
  const prior = await fitted("../longrepair/" + file,13);
  assert.equal(prior.sha,digest);
  weights[key] = prior.model;
  hashes[key + "Hash"] = prior.sha;
}
const primary = fits[0].model;
const results = {suite:SHORTDEFAULT_SUITE, primarySeed:13, fitSeeds:FIT_SEEDS,
  weightHashes:Object.fromEntries(fits.map(f => [f.seed, f.sha])), ...hashes, banks:{}, splits:{}};

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
      if (!cache.has(key)) cache.set(key, shortDefaultProposal(closureFrame(obs), world.legalActions(), weights));
      const chosen = choose(cache.get(key), obs);
      assert(performance.now() - start <= DECISION_MS, "Dispatch exceeded one second");
      world.step(chosen);
      actions.push(chosen);
    }
    return {duration, path:{actions, ledger:fleetLedger(world.ledger)}};
  }
  const decisions = [];
  let incidentBoards = 0;
  const release = p => shortDefaultDecision(p, primary).chosenId;
  const {duration, path:rl} = run((p,obs) => {
    const chosenId = release(p), {status} = obs.incident;
    incidentBoards += Number(status === "warning" || status === "closed");
    if (p.eligible) decisions.push({epoch:obs.epoch, status, plannerId:p.plannerId, closureId:p.closureId, shortId:p.shortId, longId:p.longId,
      constantId:p.constantId, chosenId, alternativeId:chosenId === p.shortId ? p.longId : p.shortId});
    return chosenId;
  });
  const row = {...config, duration, rl, planner:run(p => p.plannerId).path, flatRisk:run(p => p.constantId).path,
    shortGate:run(p => p.shortId).path, longGate:run(p => p.longId).path,
    flatGate:run(p => shortDefaultDecision(p, primary, {flatGate:true}).chosenId).path};
  const forks = decisions.map(d => {
    const other = run((p,o) => o.epoch < d.epoch ? rl.actions[o.epoch] : o.epoch === d.epoch ? d.alternativeId : release(p)).path;
    return {...config, duration, ...d, chosen:rl, alternative:other, netGain:rl.ledger.net - other.ledger.net,
      serviceGain:rl.ledger.served - other.ledger.served};
  });
  const fitLedgers = [rl.ledger, ...fits.slice(1).map(f => run(p => shortDefaultDecision(p, f.model).chosenId).path.ledger)];
  return {row, forks, fitLedgers, incidentBoards};
}

function representativeForks(examples) {
  const result = [];
  for (const adopt of [true,false]) for (const sign of [1,-1,0]) {
    const bucket = examples.filter(e => (e.chosenId === e.longId) === adopt && Math.sign(e.netGain) === sign);
    if (!bucket.length) continue;
    const values = bucket.map(e => e.netGain).sort((a,b) => a-b);
    const median = (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
    result.push(bucket.reduce((a,b) => Math.abs(a.netGain - median) <= Math.abs(b.netGain - median) ? a : b));
  }
  return result;
}
function decisionCounts(forks) {
  const adopted = forks.filter(f => f.chosenId === f.longId), deferred = forks.filter(f => f.chosenId === f.shortId);
  function outcomes(branches) {
    const wins = branches.filter(f=>f.netGain>0).length, losses = branches.filter(f=>f.netGain<0).length;
    return {wins, ties:branches.length - wins - losses, losses,
      net:branches.length ? branches.reduce((s,f)=>s+f.netGain,0)/branches.length : null,
      servicePP:branches.length ? 10*branches.reduce((s,f)=>s+f.serviceGain,0)/branches.length : null};
  }
  return {eligible:forks.length, switched:adopted.length, deferred:deferred.length,
    outcomes:{adopted:outcomes(adopted), deferred:outcomes(deferred)}};
}
for (const split of SHORTDEFAULT_SPLITS) {
  const cases = [], rows = [], allFits = [], forks = [];
  let changed = 0, incidentBoards = 0;
  for (const config of shortDefaultCases(split)) {
    const scored = scoreWeek(config), row = scored.row;
    cases.push(row);
    rows.push({family:config.family, duration:row.duration, agent:row.rl.ledger, ...Object.fromEntries(refs.map(k => [k,row[k].ledger]))});
    allFits.push(scored.fitLedgers);
    forks.push(...scored.forks);
    changed += Number(row.rl.actions.some((id,i) => id !== row.shortGate.actions[i]));
    incidentBoards += scored.incidentBoards;
  }
  results.banks[split] = await artifact(dir, mode, split + ".json", {suite:SHORTDEFAULT_SUITE, split, cases});
  const summary = summarizeShortDefault(rows);
  const against = key => Object.fromEntries(refs.map(k => [k,k === "rl" ? summary.all.comparisons[key] :
    pairedFleetComparison(rows.map(r => ({...r,agent:r[k]})), key)]));
  const scores = fits.map(({seed},i) => {
    const block = rows.map((r,j) => ({...r,agent:allFits[j][i]}));
    const genuinelyLong = block.filter(r=>r.duration>=4);
    const fittedComparisons = keys => Object.fromEntries(keys.map(k=>[k,pairedFleetComparison(block,k)]));
    return {seed,net:block.reduce((s,r) => s+r.agent.net,0)/rows.length, onTime:10*(block.reduce((s,r) => s+r.agent.served,0)/rows.length),
      ...fittedComparisons(["planner","flatRisk","shortGate","longGate"]),
      ...(genuinelyLong.length ? {longRepairs:{shortGate:pairedFleetComparison(genuinelyLong,"shortGate"),
        longGate:pairedFleetComparison(genuinelyLong,"longGate")}} : {})};
  });
  const diagnostics = {incidentBoards, ...decisionCounts(forks), weeksChanged:changed, forked:forks.length,
    byDuration:Object.fromEntries([...new Set(rows.map(r => r.duration))].sort().map(d => [d,decisionCounts(forks.filter(f => f.duration === d))]))};
  results.splits[split] = {summary, ...summarizeShortDefaultDurations(rows), fits:scores, versusPlanner:against("planner"),
    versusFlatRisk:against("flatRisk"), diagnostics, examples:representativeForks(forks)};
  console.log("Scored",split,rows.length,"weeks and",forks.length,"paired disagreement forks.");
}
const fresh = results.splits.test.summary.all, doubleReturn = results.splits.archive.summary.all.earnsMoreThanPlanner;
results.goals = {freshProfit:fresh.earnsMoreThanPlanner, freshService:fresh.matchesPlannerService,
  freshFlatProfit:fresh.earnsMoreThanFlatRisk, freshFlatService:fresh.matchesFlatRiskService, doubleReturn,
  joint:doubleReturn && fresh.beatsPlanner && fresh.beatsFlatRisk};
await artifact(dir, mode, "results.json", results);
