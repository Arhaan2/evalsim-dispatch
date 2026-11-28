// Independently exercise the simulator entry point, without the training suffix
// cache, on a prespecified sample from every training and selection family.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {createClosureWeek} from "../../docs/lib/closure-world.js";
import {inspectPreposition} from "../../docs/lib/preposition-policy.js";
import {makeSwitchCostPolicy} from "../../docs/lib/switchcost-policy.js";
import {decideFridayGuard, fridayGuardProposal, guardOutcomes} from "../../docs/lib/fridayguard-policy.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {config, warningExamples, weights} from "./fit.mjs";

const parent = makeSwitchCostPolicy(weights.parent, weights);
function directValue(node, x) {
  if ("value" in node) return node.value;
  return directValue(x[node.feature] <= node.cut ? node.left : node.right, x);
}
function verifyDecision(week, model) {
  const settings = model.settings;
  let chosen = week.defaultId, threshold = settings.hurdle;
  if (!settings.alwaysDefault) for (const alternative of week.choices) {
    const values = guardOutcomes.map(name => {
      const head = model.heads[name];
      return head.trees.reduce((value, tree) => value + head.rate * directValue(tree, alternative.x), head.bias);
    });
    const combined = values[0] + settings.serviceWeight * values[1] + settings.netWeight * values[2] / 34;
    if (combined > threshold) {chosen = alternative.id; threshold = combined;}
  }
  assert.equal(decideFridayGuard(week, model), chosen);
  return chosen;
}
function runWeek(settings, forced) {
  const world = createClosureWeek(settings);
  const totals = {friday:0, service:0, net:0};
  let alternatives, original, features;
  while (!world.done) {
    const obs = world.observe(), menu = world.legalActions();
    let choice = parent(obs, menu);
    if (obs.incident.status === "warning") {
      const incumbent = inspectPreposition(obs, menu, weights.preposition101, weights).chosenId;
      const alternate = inspectPreposition(obs, menu, weights.preposition211, weights).chosenId;
      original = incumbent;
      alternatives = [...new Set([alternate, choice])].filter(a => a !== incumbent);
      features = fridayGuardProposal(closureFrame(obs), menu, weights).choices;
      if (forced !== undefined) assert(alternatives.includes(forced));
      choice = forced ?? incumbent;
    }
    const {action} = world.step(choice);
    if (obs.epoch === 8 || obs.epoch === 9) totals.friday += action.served;
  }
  totals.net = world.ledger.net; totals.service = world.ledger.served;
  return {totals, alternatives, original, features};
}

export function auditFit(seed) {
  const fit = JSON.parse(readFileSync(new URL("../../docs/data/fridayguard/fit-" + seed + ".json", import.meta.url)));
  assert.equal(fit.seed, seed);
  const result = {seed, weeks:0, pairs:0, sampledFridayDifferences:0, sampledOverrides:0};
  for (const [start, count] of [[fit.trainStart, config.fitCount], [fit.selectionStart, config.selectionCount]]) {
    for (const [i, family] of config.families.entries()) for (let j = 0; j < 256; j++) {
      const c = {seed:start + i * count + j, family, closure:{starts:config.starts, durations:config.durations}};
      const baseline = runWeek(c), paired = warningExamples(c);
      result.sampledOverrides += Number(verifyDecision(paired, fit) !== paired.defaultId);
      assert.equal(baseline.original, paired.defaultId);
      assert.deepEqual(baseline.alternatives, paired.choices.map(choice => choice.id));
      assert.deepEqual(baseline.features.map(a => a.x), paired.choices.map(choice => choice.x));
      for (const alternative of paired.choices) {
        const branch = runWeek(c, alternative.id);
        for (const k of guardOutcomes) assert.equal(alternative[k], branch.totals[k] - baseline.totals[k],
          "Uncached simulator disagrees with paired " + k + " for " + c.seed);
        result.pairs++;
        result.sampledFridayDifferences += Number(alternative.friday !== 0);
      }
      result.weeks++;
    }
  }
  assert(result.pairs > 0, "The audit sample contains no disagreements");
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  for (const seed of arg === undefined ? config.seeds : [Number(arg)]) console.log(auditFit(seed));
}
