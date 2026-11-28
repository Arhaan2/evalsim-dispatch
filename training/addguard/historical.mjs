import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {addGuardDecision, addGuardProposal} from "../../docs/lib/addguard-policy.js";
import {artifact, hash} from "../fleetweek/score-helpers.mjs";
import {checkpoints, data} from "./checkpoints.mjs";

const mode = process.argv[2];
assert(["--write", "--check"].includes(mode), "Use --write or --check.");
const {weights, fits} = await checkpoints();
const parentStudy = JSON.parse(await readFile(new URL("../switchcost/results.json", data)));
const parentIndex = parentStudy.fitSeeds.indexOf(73);
assert(parentIndex >= 0);
const bytes = await readFile(new URL("../switchcost/test.json", data));
assert.equal(hash(bytes), parentStudy.banks.test);
const bank = JSON.parse(bytes);
assert.equal(bank.suite, "dispatch-switchcost-v1");
assert.equal(bank.cases.length, 32768);

const counts = () => ({losses:0, wins:0, ties:0});
const results = fits.map(({seed}) => ({seed, vetoed:counts(), kept:counts(), profitableCaught:0}));
const additions = [];
let disagreements = 0, profitable = 0, parentCaught = 0, moveRecallCaught = 0;
for (const week of bank.cases) {
  if (!week.opportunities.length) continue;
  const world = createClosureWeek(week);
  const opportunities = new Map(week.opportunities.map(o => [o.epoch, o]));
  while (!world.done) {
    const obs = world.observe();
    const o = opportunities.get(obs.epoch);
    if (o) {
      const p = addGuardProposal(closureFrame(obs), world.legalActions(), weights);
      const parentTook = o.predictions[parentIndex].switched;
      assert.equal(p.parent.chosenId, parentTook ? o.longId : o.shortId);
      assert.equal(p.guardEligible, parentTook && !o.previous.switched);
      assert.equal(o.netGain, o.alternative.ledger.net - week.shortGate.ledger.net);
      assert.equal(o.shortId, week.shortGate.actions[o.epoch]);
      disagreements++;
      const won = o.netGain > 0;
      profitable += Number(won);
      parentCaught += Number(won && parentTook);
      moveRecallCaught += Number(won && o.previous.switched);
      const outcome = won ? "wins" : o.netGain < 0 ? "losses" : "ties";
      const vetoedBy = [];
      for (const [i, {model, seed}] of fits.entries()) {
        const decision = addGuardDecision(p, model);
        if (!p.guardEligible) assert.equal(decision.chosenId, p.parent.chosenId);
        results[i].profitableCaught += Number(won && decision.chosenId === o.longId);
        if (p.guardEligible) {
          results[i][decision.guardVetoed ? "vetoed" : "kept"][outcome]++;
          if (decision.guardVetoed) vetoedBy.push(seed);
        }
      }
      if (p.guardEligible) additions.push({family:week.family, seed:week.seed, epoch:o.epoch,
        shortAction:o.shortId, longAction:o.longId, longMinusShortCredits:o.netGain, vetoedBy});
    }
    world.step(week.shortGate.actions[obs.epoch]);
  }
}
assert.deepEqual([disagreements, profitable, parentCaught, moveRecallCaught, additions.length], [277, 128, 89, 83, 24]);
for (const r of results) {
  assert.deepEqual(["losses", "wins", "ties"].map(k=>r.kept[k] + r.vetoed[k]), [6, 15, 3]);
  assert.equal(r.profitableCaught, parentCaught - r.vetoed.wins);
}
const report = {edition:"switchcost-v1.0.0", split:"test", bankHash:parentStudy.banks.test, disagreements,
  profitable, parentCaught, moveRecallCaught, fits:results, additions};
await artifact(data, mode, "historical.json", report);
console.log("Replayed the 24 historical additions on the short route, including all six losing choices.", results);
