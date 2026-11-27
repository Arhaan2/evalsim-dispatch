import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {moveRecallProposal, moveRecallDecision} from "../../docs/lib/moverecall-policy.js";
import {MOVERECALL_REFERENCES as refs, MOVERECALL_SPLITS, MOVERECALL_SUITE, moveRecallCases,
  summarizeMoveRecall, summarizeMoveRecallDurations} from "../../docs/lib/moverecall-study.js";
import {FIT_SEEDS, DECISION_MS, fleetLedger, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {artifact, hash, legacyCheckpoint} from "../fleetweek/score-helpers.mjs";

import {pairedRecall} from "./paired-recall.mjs";
import {representativeForks,decisionCounts} from "../fleetweek/repair-forks.mjs";
import {detectorInterval,detectorStats} from "../longmove/detector.mjs";

const mode = process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write to score or --check to verify.");
const dir = new URL("../../docs/data/moverecall/", import.meta.url);
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
const predecessor = JSON.parse(await readFile(new URL("../longmove/results.json",dir)));
const oldFit = await fitted("../longmove/fit-13.json",13);
assert.equal(oldFit.sha,predecessor.weightHashes[13]);
weights.previous = oldFit.model;
hashes.previousHash = oldFit.sha;
const primary = fits[0].model;
const results = {suite:MOVERECALL_SUITE, primarySeed:13, fitSeeds:FIT_SEEDS,
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
      if (!cache.has(key)) cache.set(key, moveRecallProposal(closureFrame(obs), world.legalActions(), weights));
      const chosen = choose(cache.get(key), obs);
      assert(performance.now() - start <= DECISION_MS, "Dispatch exceeded one second");
      world.step(chosen);
      actions.push(chosen);
    }
    return {duration, path:{actions, ledger:fleetLedger(world.ledger)}};
  }
  const decisions = [];
  let incidentBoards = 0;
  const release = p => moveRecallDecision(p, primary).chosenId;
  const {duration, path:rl} = run((p,obs) => {
    const {chosenId,winProbability,expectedNet} = moveRecallDecision(p,primary), {status} = obs.incident;
    incidentBoards += Number(status === "warning" || status === "closed");
    if (p.eligible) decisions.push({epoch:obs.epoch, status, winProbability, expectedNet, previousChoiceId:p.previousId, previousProbability:p.previous.winProbability, plannerId:p.plannerId, closureId:p.closureId, shortId:p.shortId, longId:p.longId,
      constantId:p.constantId, chosenId, alternativeId:chosenId === p.shortId ? p.longId : p.shortId});
    return chosenId;
  });
  // Establish opportunities on the historical default, independently of every fitted gate.
  const onShort = [];
  const {path:shortGate} = run((p,obs) => {
    if (p.shortId!==p.longId) {
      const predictions = fits.map(({model}) => {
        const d=moveRecallDecision(p,model);
        return {probability:d.winProbability,switched:d.chosenId===p.longId};
      });
      onShort.push({epoch:obs.epoch,shortId:p.shortId,longId:p.longId,
        previous:{probability:p.previous.winProbability,switched:p.previousId===p.longId},predictions});
    }
    return p.shortId;
  });
  const opportunities = onShort.map(d => {
    const alternative=run((p,o)=>o.epoch<d.epoch ? shortGate.actions[o.epoch] : o.epoch===d.epoch ? d.longId : p.shortId).path;
    return {...d,alternative,netGain:alternative.ledger.net-shortGate.ledger.net,serviceGain:alternative.ledger.served-shortGate.ledger.served};
  });
  const row = {...config, duration, opportunities, rl, planner:run(p => p.plannerId).path, flatRisk:run(p => p.constantId).path,
    shortGate, longGate:run(p => p.longId).path, previous:run(p => p.previousId).path,
    flatGate:run(p => moveRecallDecision(p, primary, {flatGate:true}).chosenId).path};
  const forks = decisions.map(d => {
    const other = run((p,o) => o.epoch < d.epoch ? rl.actions[o.epoch] : o.epoch === d.epoch ? d.alternativeId : release(p)).path;
    return {...config, duration, ...d, chosen:rl, alternative:other, netGain:rl.ledger.net - other.ledger.net,
      serviceGain:rl.ledger.served - other.ledger.served};
  });
  const fitLedgers = [rl.ledger, ...fits.slice(1).map(f => run(p => moveRecallDecision(p, f.model).chosenId).path.ledger)];
  return {row, forks, fitLedgers, incidentBoards};
}

for (const split of MOVERECALL_SPLITS) {
  const cases = [], rows = [], allFits = [], forks = [];
  let changed = 0, incidentBoards = 0;
  for (const config of moveRecallCases(split)) {
    const scored = scoreWeek(config), row = scored.row;
    cases.push(row);
    rows.push({family:config.family, duration:row.duration, agent:row.rl.ledger, ...Object.fromEntries(refs.map(k => [k,row[k].ledger]))});
    allFits.push(scored.fitLedgers);
    forks.push(...scored.forks);
    changed += Number(row.rl.actions.some((id,i) => id !== row.shortGate.actions[i]));
    incidentBoards += scored.incidentBoards;
  }
  results.banks[split] = await artifact(dir, mode, split + ".json", {suite:MOVERECALL_SUITE, split, cases});
  const summary = summarizeMoveRecall(rows);
  const against = key => Object.fromEntries(refs.map(k => [k,k === "rl" ? summary.all.comparisons[key] :
    pairedFleetComparison(rows.map(r => ({...r,agent:r[k]})), key)]));
  const scores = fits.map(({seed},i) => {
    const block = rows.map((r,j) => ({...r,agent:allFits[j][i]}));
    const genuinelyLong = block.filter(r=>r.duration>=4);
    const fittedComparisons = keys => Object.fromEntries(keys.map(k=>[k,pairedFleetComparison(block,k)]));
    return {seed,net:block.reduce((s,r) => s+r.agent.net,0)/rows.length, onTime:10*(block.reduce((s,r) => s+r.agent.served,0)/rows.length),
      ...fittedComparisons(["planner","flatRisk","shortGate","longGate","previous"]),
      ...(genuinelyLong.length ? {longRepairs:{shortGate:pairedFleetComparison(genuinelyLong,"shortGate"),
        longGate:pairedFleetComparison(genuinelyLong,"longGate"),previous:pairedFleetComparison(genuinelyLong,"previous")}} : {})};
  });
  const diagnostics = {incidentBoards, ...decisionCounts(forks), weeksChanged:changed, forked:forks.length,
    byDuration:Object.fromEntries([...new Set(rows.map(r => r.duration))].sort().map(d => [d,decisionCounts(forks.filter(f => f.duration === d))]))};
  const fixed = cases.flatMap(c=>c.opportunities.map(o=>({...o,duration:c.duration,family:c.family,seed:c.seed})));
  const scoreDetector = (subset,i) => detectorStats(subset,i,fits[i].model.calibration.win.mean);
  function comparison(subset,i) {
    const previousRows=subset.map(o=>({...o,predictions:[o.previous]}));
    return {...scoreDetector(subset,i),previous:detectorStats(previousRows,0,weights.previous.calibration.win.mean),
      vsPrevious:pairedRecall(subset,i)};
  }
  const primaryDetection = subset => ({...comparison(subset,0),uncertainty:detectorInterval(subset,primary.calibration.win.mean)});
  const detection = {all:primaryDetection(fixed),fits:fits.map(({seed},i)=>({seed,...comparison(fixed,i)})),
    priorSkipped:primaryDetection(fixed.filter(o=>!o.previous.switched)),
    byFamily:Object.fromEntries([...new Set(cases.map(c=>c.family))].map(f=>[f,primaryDetection(fixed.filter(o=>o.family===f))])),
    ...(cases[0].closure ? {durationGroups:{short:primaryDetection(fixed.filter(o=>o.duration<=3)),
      long:primaryDetection(fixed.filter(o=>o.duration>=4))}} : {})};
  results.splits[split] = {summary, detection, ...summarizeMoveRecallDurations(rows), fits:scores, versusPlanner:against("planner"),
    versusFlatRisk:against("flatRisk"), diagnostics, examples:representativeForks(forks)};
  console.log("Scored",split,rows.length,"weeks and",forks.length,"paired disagreement forks.");
}
const fresh = results.splits.test.summary.all, doubleReturn = results.splits.archive.summary.all.earnsMoreThanPlanner;
const interval=results.splits.test.detection.all.vsPrevious.recall95;
const recall=interval!==null && interval[0]>0;
results.goals = {recall,freshProfit:fresh.earnsMoreThanPlanner, freshService:fresh.matchesPlannerService,
  freshShortProfit:fresh.earnsMoreThanShortGate, freshShortService:fresh.matchesShortGateService,
  freshFlatProfit:fresh.earnsMoreThanFlatRisk, freshFlatService:fresh.matchesFlatRiskService, doubleReturn,
  joint:recall && doubleReturn && fresh.beatsPlanner && fresh.beatsFlatRisk && fresh.beatsShortGate};
await artifact(dir, mode, "results.json", results);
