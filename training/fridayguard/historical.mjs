// Replay the prior public bank only after the new fit hashes have been locked.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {loadPrepositionBank} from "../../docs/lib/preposition-study.js";
import {decisionFromProposal, prepositionProposal} from "../../docs/lib/preposition-policy.js";
import {decideFridayGuard, fridayGuardProposal} from "../../docs/lib/fridayguard-policy.js";
import {fleetLedger} from "../../docs/lib/fleetweek-study.js";
import {checkpoints as previousCheckpoints} from "../preposition/checkpoints.mjs";
import {artifact, hash} from "../fleetweek/score-helpers.mjs";
import {delivered} from "../preposition/contracts.mjs";

const mode = process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write or --check.");
const data = new URL("../../docs/data/fridayguard/", import.meta.url);
const previous = new URL("../preposition/", data);
const source = JSON.parse(await readFile(new URL("results.json",previous)));
const current = JSON.parse(await readFile(new URL("results.json",data)));
const locked = await previousCheckpoints();
const weights = {...locked.weights};
for (const seed of [101,211]) {
  const fit = locked.fits.find(f => f.seed === seed);
  assert.equal(fit.sha, current["preposition"+seed+"Hash"]);
  weights["preposition"+seed] = fit.model;
}
const fits = await Promise.all(current.fitSeeds.map(async seed => {
  const bytes = await readFile(new URL("fit-"+seed+".json",data));
  assert.equal(hash(bytes), current.weightHashes[seed]);
  return JSON.parse(bytes);
}));
const bank = await loadPrepositionBank("test", async (file,digest) => {
  const bytes = await readFile(new URL(file,previous));
  assert.equal(hash(bytes),digest);
  return JSON.parse(bytes);
}, source.banks.test);
assert.equal(bank.cases.length,32768);
const baseline = {misses:0, saves:0};
const output = fits.map(f => ({seed:f.seed, preventedMisses:0, repeatedMisses:0, retainedSaves:0, forgoneSaves:0,
  introducedMisses:0, newSaves:0, fridayDeltaVs101:0, weekDeliveriesVs101:0, netCreditsVs101:0,
  changedWarnings:0, examples:[]}));
const originalMisses = [], originalSaves = [];

for (const row of bank.cases) {
  const {family,seed,closure,warningEpoch} = row;
  const config = {family,seed,closure};
  const prefix = row.previous.actions.slice(0,warningEpoch);
  const week = createClosureWeek(config);
  for (const action of prefix) week.step(action);
  const frame = closureFrame(week.observe()), menu = week.legalActions();
  const p = fridayGuardProposal(frame,menu,weights);
  const old = prepositionProposal(frame,menu,weights);
  const defaultId = decisionFromProposal(old,weights.preposition101).chosenId;
  assert.equal(defaultId,p.defaultId);
  assert.equal(old.parentId,row.previous.actions[warningEpoch]);
  const routes = new Map([[old.parentId,row.previous]]);
  function finish(id) {
    if (routes.has(id)) return routes.get(id);
    const sim = createClosureWeek(config), actions = [...prefix,id];
    for (const action of actions) sim.step(action);
    while (!sim.done) {
      const after = prepositionProposal(closureFrame(sim.observe()),sim.legalActions(),weights);
      assert.equal(after.warning,false);
      sim.step(after.parentId);
      actions.push(after.parentId);
    }
    const route = {actions, ledger:fleetLedger(sim.ledger)};
    routes.set(id,route);
    return route;
  }
  const inherited = finish(defaultId);
  const choices = fits.map(fit => decideFridayGuard(p,fit));
  const paths = choices.map(finish);
  for (const [i,result] of output.entries()) {
    result.changedWarnings += Number(choices[i] !== defaultId);
    result.netCreditsVs101 += paths[i].ledger.net - inherited.ledger.net;
    result.weekDeliveriesVs101 += paths[i].ledger.served - inherited.ledger.served;
  }
  for (const epoch of [8,9]) {
    const original = delivered(row.previous.actions[epoch]);
    const old101 = delivered(inherited.actions[epoch]);
    const kind = original && !old101 ? "misses" : old101 && !original ? "saves" : null;
    if (kind) {
      baseline[kind]++;
      (kind === "misses" ? originalMisses : originalSaves).push({family,seed,epoch,
        servedByNewFits:fits.filter((_,i) => delivered(paths[i].actions[epoch])).map(f=>f.seed)});
    }
    for (const [i,result] of output.entries()) {
      const served = delivered(paths[i].actions[epoch]);
      result.fridayDeltaVs101 += Number(served) - Number(old101);
      let outcome;
      if (kind === "misses") outcome = served ? "preventedMisses" : "repeatedMisses";
      else if (kind === "saves") outcome = served ? "retainedSaves" : "forgoneSaves";
      else if (old101 && !served) outcome = "introducedMisses";
      else if (!old101 && served) outcome = "newSaves";
      if (outcome) {
        result[outcome]++;
        if (!result.examples.some(e=>e.kind===outcome)) result.examples.push({kind:outcome,family,seed,epoch,warningEpoch,
          fit101Action:defaultId,newAction:choices[i],fit101WeekNet:inherited.ledger.net,newWeekNet:paths[i].ledger.net});
      }
    }
  }
}
assert.deepEqual(baseline,{misses:39,saves:35});
for (const r of output) {
  assert.equal(r.preventedMisses+r.repeatedMisses,baseline.misses);
  assert.equal(r.retainedSaves+r.forgoneSaves,baseline.saves);
  assert.equal(r.preventedMisses+r.newSaves-r.introducedMisses-r.forgoneSaves,r.fridayDeltaVs101);
}
await artifact(data,mode,"historical.json",{suite:current.suite,sourceTag:"preposition-v1.0.0",
  sourceBankHash:source.banks.test,modelHashes:current.weightHashes,weeks:bank.cases.length,
  baseline,fits:output,originalMisses,originalSaves});
console.table(output.map(({seed,preventedMisses,introducedMisses,retainedSaves,newSaves,fridayDeltaVs101,netCreditsVs101})=>
  ({seed,preventedMisses,introducedMisses,retainedSaves,newSaves,fridayDeltaVs101,netCreditsVs101})));
