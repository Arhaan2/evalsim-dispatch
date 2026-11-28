import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {addGuardCases, loadAddGuardBank} from "../../docs/lib/addguard-study.js";
import {addGuardProposal, addGuardDecision, makeAddGuardPolicy} from "../../docs/lib/addguard-policy.js";
import {selectionRunnerUp} from "../../docs/lib/addguard-candidate.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {fleetLedger, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {artifact, hash} from "../fleetweek/score-helpers.mjs";
import {recognitionGroups} from "./recognition.mjs";
import {checkpoints, data} from "./checkpoints.mjs";

const mode = process.argv[2];
assert(["--write", "--check"].includes(mode));
const release = JSON.parse(await readFile(new URL("results.json", data)));
const {fits, weights} = await checkpoints();
const fit = fits.find(f => f.seed === 101);
assert.equal(release.weightHashes[101], fit.sha);
const model = selectionRunnerUp(fit.model);
const choose = makeAddGuardPolicy(model, weights);
async function readVerified(file, expected) {
  const bytes = await readFile(new URL(file, data));
  assert.equal(hash(bytes), expected, file);
  return JSON.parse(bytes);
}
function pairedMoves(cases, historical) {
  const rows = [], examples = [];
  for (const c of cases) {
    if (!c.opportunities.length) continue;
    const world = createClosureWeek(c);
    const byTime = new Map(c.opportunities.map(o => [o.epoch, o]));
    while (!world.done) {
      const obs = world.observe(), o = byTime.get(obs.epoch);
      if (o) {
        const p = addGuardProposal(closureFrame(obs), world.legalActions(), weights);
        const d = addGuardDecision(p, model);
        const parent = p.parent.chosenId === o.longId, original = p.recallId === o.longId;
        assert.equal(parent, historical ? o.predictions[historical.parentIndex].switched : o.previous.switched);
        assert.equal(original, historical ? o.previous.switched : o.original.switched);
        assert.equal(d.guardEligible, parent && !original);
        assert.equal(o.netGain, o.alternative.ledger.net - c.shortGate.ledger.net);
        rows.push({family:c.family, seed:c.seed, guardEligible:d.guardEligible, netGain:o.netGain,serviceGain:o.serviceGain,
          previous:{switched:parent}, original:{switched:original}, predictions:[{switched:d.chosenId===o.longId}]});
        if (d.guardVetoed) examples.push({family:c.family, seed:c.seed, epoch:o.epoch, shortId:o.shortId, longId:o.longId,
          shortFriday:c.shortGate.ledger.net, longFriday:o.alternative.ledger.net, longMinusShort:o.netGain});
      }
      world.step(c.shortGate.actions[obs.epoch]);
    }
  }
  const groups = recognitionGroups(rows);
  return {groups, examples};
}
function economics(bank) {
  const keys = ["previous", "shortGate", "flatRisk", "planner", "original"];
  let differentWeeks = 0, changedActions = 0;
  const rows = bank.cases.map(c => {
    const w = createClosureWeek(c);
    let diff = 0;
    while (!w.done) {
      const o = w.observe(), id = choose(o,w.legalActions());
      diff += Number(id !== c.previous.actions[o.epoch]);
      w.step(id);
    }
    changedActions += diff; differentWeeks += Number(diff > 0);
    return {family:c.family, agent:fleetLedger(w.ledger), ...Object.fromEntries(keys.map(k=>[k,c[k].ledger]))};
  });
  return {weeks:rows.length, differentWeeks, changedActions,
    comparisons:Object.fromEntries(keys.map(k=>[k,pairedFleetComparison(rows,k)]))};
}
const parentRelease = JSON.parse(await readFile(new URL("../switchcost/results.json",data)));
const old = await readVerified("../switchcost/test.json",parentRelease.banks.test);
const history = pairedMoves(old.cases,{parentIndex:parentRelease.fitSeeds.indexOf(73)});
assert.equal(history.groups.added.vsParent.n,24);
const freshBank = await loadAddGuardBank("test",readVerified,release.banks.test);
const archiveBank = await loadAddGuardBank("archive",readVerified,release.banks.archive);
assert.equal(freshBank.cases.length,addGuardCases("test").length);
const fresh = pairedMoves(freshBank.cases);
const selection = fit.model.selection.candidates.find(c => c.settings.fraction === model.settings.fraction);
const report = {suite:release.suite, policy:"candidate-101", checkpoint:fit.sha, selection,
  history, fresh, weekly:economics(freshBank), archive:economics(archiveBank)};
assert.equal(report.archive.changedActions, 0);
assert.equal(release.splits.archive.diagnostics.constantActionDifferences, 0);
await artifact(data,mode,"tradeoff.json",report);
console.log("Scored selection runner-up on",report.weekly.weeks,"fresh weeks and",report.archive.weeks,"archive weeks.");
