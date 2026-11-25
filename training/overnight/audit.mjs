// The verifier shares the original lab's independent accounting and paired bootstrap.
// It reconstructs the counterfactual move menu and follows each changed action to Friday.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chooseFleetGreedy, chooseFleetPlanner } from "../../docs/lib/fleetweek-planner.js";
import { makeFleetPolicy } from "../../docs/lib/fleetweek-policy.js";
import { makeOvernightPolicy } from "../../docs/lib/overnight-policy.js";
import { average, paired, publicFrames, replay } from "../fleetweek/audit-helpers.mjs";

const expectedSuite = "dispatch-overnight-v1";
const fits = [13, 37, 73, 101, 211];
const references = ["rl", "planner", "greedy", "previous", "noEmpty"];
const root = new URL("../../docs/data/overnight/", import.meta.url);
const manifest = [
  {split:"validation", count:128, start:150000000, families:["morning-loop","delayed-homecoming"]},
  {split:"test", count:512, start:160000000, families:["early-double-return","late-double-return","overnight-relay","late-homecoming"]},
  {split:"archive", count:1024, start:170000000, families:["double-return"]},
];

async function artifact(name, expectedHash) {
  const bytes = await readFile(new URL(name, root));
  if (expectedHash !== undefined) {
    assert.match(expectedHash, /^[a-f0-9]{64}$/);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, name);
  }
  return JSON.parse(bytes);
}

const isNight = epoch => [1, 3, 5, 7].includes(epoch);
const empty = move => /^E[0-2]$/.test(move);
const signed = move => ["C", "S0", "S1"].includes(move);

function blockEmpty(id) {
  return id.split("|").map(move => empty(move) ? "W" : move).join("|");
}

function otherPlan(observation, legal, selected) {
  if (!isNight(observation.epoch)) return null;
  const moves = selected.split("|");
  if (moves.some(empty)) return blockEmpty(selected);
  if (moves.every(signed)) return null;
  const candidates = legal.filter(action => action.moves.some(empty) &&
    moves.every((m, truck) => signed(m) ? action.moves[truck] === m : !signed(action.moves[truck])));
  return chooseFleetPlanner(observation, candidates);
}

function scoreWeek(row, policies, previous) {
  const frames = publicFrames(row);
  const options = new Map(), overrides = new Map();
  const released = (observation, legal) => {
    const id = policies[0](observation, legal);
    const alt = otherPlan(observation, legal, id);
    if (alt !== null) options.set(observation.epoch, alt);
    const planner = chooseFleetPlanner(observation,legal);
    if (planner !== id) {
      assert(isNight(observation.epoch));
      const plan = planner.split("|");
      assert(id.split("|").every((code,i)=>signed(code) ? code===plan[i] : !signed(plan[i])));
      overrides.set(observation.epoch,planner);
    }
    return id;
  };
  const asNoEmpty = (observation, legal) => {
    const id = policies[0](observation, legal);
    return isNight(observation.epoch) ? blockEmpty(id) : id;
  };
  const fitted = policies.map((p, i) => i === 0 ? replay(frames,released,row.rl) : replay(frames,p));
  const evaluated = { family:row.family, agent:fitted[0], rl:fitted[0], fits:fitted,
    planner:replay(frames,chooseFleetPlanner,row.planner), greedy:replay(frames,chooseFleetGreedy,row.greedy),
    previous:replay(frames,previous,row.previous), noEmpty:replay(frames,asNoEmpty,row.noEmpty) };
  // Isolate this night's intervention. Earlier joint moves are the independently checked
  // release trajectory; all later decisions come from the same learned continuation.
  function changeOneNight(epoch, alternative) {
    const suffix = [];
    const ledger = replay(frames,(obs, legal) => {
      if (obs.epoch < epoch) return row.rl.actions[obs.epoch];
      const id = obs.epoch === epoch ? alternative : policies[0](obs,legal);
      suffix.push(id);
      return id;
    });
    return {suffix, ledger};
  }
  const verifyBranches = (choices, records, againstPlanner) => {
    assert.equal(records.length, choices.size);
    return [...choices].map(([epoch,alternative],i) => {
      const chosen = row.rl.actions[epoch];
      assert.notEqual(alternative,chosen);
      const {suffix,ledger} = changeOneNight(epoch,alternative);
      const tuple = againstPlanner ? [epoch,alternative] : [epoch,chosen,alternative];
      assert.deepEqual(records[i],[...tuple,suffix,ledger.net,ledger.served]);
      const moves = chosen.split("|").some(empty), altMoves = alternative.split("|").some(empty);
      const type = againstPlanner ? (moves ? (altMoves ? "redirect" : "toMove") : "toStay") : (moves ? "move" : "stay");
      return {family:row.family,seed:row.seed,epoch,chosen,alternative,type,suffix,
        alternativeLedger:ledger, chosenRecord:row.rl,
        netGain:evaluated.rl.net-ledger.net, serviceGain:evaluated.rl.served-ledger.served};
    });
  };
  return {evaluated, nights:verifyBranches(options,row.branches,false), changes:verifyBranches(overrides,row.overrides,true)};
}

function verifySection(rows, section) {
  assert.equal(section.weeks, rows.length);
  assert.deepEqual(Object.keys(section.comparisons).sort(), [...references].sort());
  for (const ref of ["agent", ...references]) {
    assert.deepEqual(average(rows,ref), section.policies[ref]);
    if (ref !== "agent") assert.deepEqual(paired(rows,ref), section.comparisons[ref]);
  }
  const comparison = section.comparisons.planner;
  assert.equal(section.earnsMoreThanPlanner, comparison.net95[0] > 0);
  assert.equal(section.matchesPlannerService, comparison.servicePP >= 0 && comparison.service95[0] >= 0);
  assert.equal(section.beatsPlanner, section.earnsMoreThanPlanner && section.matchesPlannerService);
}

function totals(records) {
  return {nights:records.length,helped:records.filter(r=>r.netGain>0).length,
    tied:records.filter(r=>r.netGain===0).length,hurt:records.filter(r=>r.netGain<0).length,
    netGain:records.reduce((sum,r)=>sum+r.netGain,0),serviceGain:records.reduce((sum,r)=>sum+r.serviceGain,0)};
}

function representative(records) {
  const ordered = [...records].sort((a,b)=>a.netGain-b.netGain);
  const last = ordered.length-1;
  const mid = (ordered[Math.floor(last/2)].netGain + ordered[Math.ceil(last/2)].netGain)/2;
  const minDistance = Math.min(...ordered.map(r=>Math.abs(r.netGain-mid)));
  const r = records.find(x=>Math.abs(x.netGain-mid)===minDistance);
  const prefix = r.chosenRecord.actions.slice(0,r.epoch);
  return {family:r.family,seed:r.seed,epoch:r.epoch,choice:r.type,chosenId:r.chosen,alternativeId:r.alternative,
    prefix,chosen:r.chosenRecord,alternative:{actions:[...prefix,...r.suffix],ledger:r.alternativeLedger},
    netGain:r.netGain,serviceGain:r.serviceGain};
}

function verifyDiagnostics(diagnostics, weeks, nights, changes) {
  assert.equal(diagnostics.nights,4*weeks);
  assert.equal(diagnostics.eligible,nights.length);
  const examples = [];
  for (const type of ["move","stay"]) {
    const group=nights.filter(r=>r.type===type);
    assert.deepEqual(diagnostics[type],totals(group));
    for (const sign of [1,-1]) {
      const subset=group.filter(r=>Math.sign(r.netGain)===sign);
      if (subset.length) examples.push(representative(subset));
    }
  }
  assert.deepEqual(diagnostics.examples,examples);
  const countBy = type => changes.filter(r=>r.type===type).length;
  assert.deepEqual(diagnostics.plannerChanges,{...totals(changes),
    toMove:countBy("toMove"),toStay:countBy("toStay"),redirect:countBy("redirect")});
}

const results = await artifact("results.json");
assert.equal(results.suite, expectedSuite);
assert.deepEqual(results.fitSeeds, fits);
assert.equal(results.primarySeed, 13);
const previous = makeFleetPolicy(await artifact("../fleetweek/model-13.json", results.previousHash));
const policies = [];
for (const seed of fits) policies.push(makeOvernightPolicy(await artifact("model-"+seed+".json", results.weightHashes[seed])));
for (const {split, count, start, families} of manifest) {
  const bank = await artifact(split+".json", results.banks[split]);
  assert.equal(bank.suite,expectedSuite);
  assert.equal(bank.split,split);
  assert.equal(bank.cases.length,count*families.length);
  const rows = [], nights = [], changes = [];
  for (const [i,row] of bank.cases.entries()) {
    const f = Math.floor(i/count);
    assert.equal(row.family,families[f]);
    assert.equal(row.seed,start+10000*f+i%count);
    const verified=scoreWeek(row,policies,previous);
    rows.push(verified.evaluated);
    nights.push(...verified.nights);
    changes.push(...verified.changes);
  }
  const reported = results.splits[split];
  verifyDiagnostics(reported.diagnostics,rows.length,nights,changes);
  verifySection(rows,reported.summary.all);
  assert.deepEqual(Object.keys(reported.summary.byFamily),families);
  for (const f of families) verifySection(rows.filter(r=>r.family===f),reported.summary.byFamily[f]);
  assert.deepEqual(reported.fits.map(f=>f.seed),fits);
  for (const [i,row] of reported.fits.entries()) {
    const samples=rows.map(r=>({...r,agent:r.fits[i]}));
    assert.equal(average(samples,"agent").net,row.net);
    assert.equal(average(samples,"agent").onTime,row.onTime);
    assert.deepEqual(paired(samples,"planner"),row.planner);
  }
  console.log(split + ": rebuilt ledgers and costs for " + rows.length +
    " weeks, nine full policies per week, " + nights.length + " move/stay alternatives and " + changes.length +
    " planner overrides through Friday.");
}
const test = results.splits.test.summary.all, archive = results.splits.archive.summary.all;
assert.deepEqual(results.goals,{freshProfit:test.earnsMoreThanPlanner,freshService:test.matchesPlannerService,
  doubleReturn:archive.earnsMoreThanPlanner,joint:test.beatsPlanner && archive.earnsMoreThanPlanner});
console.log("Verified all five fits, paired intervals and registered earnings, service and retention criteria.");
