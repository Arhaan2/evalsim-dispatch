// Post-hoc replay. The published fit, benchmark endpoints and checks are frozen.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SURVEY_PATTERNS, surveyCases, createSurvey, observeSurvey, stepSurvey, verifySurvey, stochasticPlanner } from "../../docs/lib/survey.js";
import { chooseSurvey, forecastPath, lookup, mixSlotCosts, returnPath, surveyDecision, surveyEvidence } from "../../docs/lib/survey-policy.js";
import { pairedReserve } from "../../docs/lib/reserve-policy.js";
import { chooseRally } from "../../docs/lib/rally-policy.js";

const release = JSON.parse(readFileSync(new URL("../../docs/data/survey/results.json", import.meta.url)));
const model = release.checkpoint.weights;

// This intervention holds the full model's conditional slot values and priority
// weights fixed. It substitutes literal bulletin odds for the learned gate on
// every delayed reading. The published always-use control separately refits its
// downstream return estimates and is a different comparison.
function literalGate(o) {
  if (!o.slots || o.wave < 3) return chooseSurvey(o, model);
  const e = surveyEvidence(o);
  const row = lookup(model.returns[o.wave], returnPath(e, true));
  const costs = mixSlotCosts(o.quote.highChance, row);
  return o.offer.net >= (o.slots === 1 ? costs.one : costs.two) ? "accept" : "pass";
}
const cases = surveyCases("test"), scores = [], forecasts = [], disagreement = {};
assert.equal(cases.length, release.cases.length);
for (const [i, config] of cases.entries()) {
  const { seed, family } = config, p = SURVEY_PATTERNS[family], hot = Number(p.ending === "hot");
  const target = p.stratum + "/" + p.ending;
  const groups = disagreement[target] ??= {};
  const fitted = createSurvey(config), forced = createSurvey(config), baseline = createSurvey(config);
  let o = observeSurvey(fitted), first = "identicalActions", firstWave = null, gatesDiffer = 0;
  while (!o.done) {
    const decision = surveyDecision(o, model);
    const planner = stochasticPlanner(observeSurvey(baseline));
    if (first === "identicalActions" && decision.action !== planner) {
      first = decision.action === "accept" ? "modelBooksFirstAtDisagreement" : "modelWaitsFirstAtDisagreement";
      firstWave = o.wave + 1;
    }
    if (o.wave >= 3 && literalGate(o) !== decision.action) gatesDiffer++;
    if (o.wave === 6) {
      const raw = lookup(model.forecast[o.wave].raw, forecastPath(surveyEvidence(o), true));
      forecasts.push({ seed, rawBrier: (raw - hot) ** 2, calibratedBrier: (decision.persistence - hot) ** 2 });
    }
    stepSurvey(baseline, planner);
    stepSurvey(forced, literalGate(observeSurvey(forced)));
    o = stepSurvey(fitted, decision.action);
  }
  const net = [fitted, baseline, forced].map(s => {
    const result = verifySurvey(s);
    assert.deepEqual(result.violations, []);
    return result.net;
  });
  const saved = release.cases[i];
  assert.deepEqual([seed, family, net[0], net[1]], [saved.seed, saved.family, saved.rl, saved.stochastic]);
  const group = groups[first] ??= { shifts: 0, completeShiftCreditGap: 0, byFirstDisagreementWave: {} };
  if (firstWave !== null) group.byFirstDisagreementWave[firstWave] = (group.byFirstDisagreementWave[firstWave] ?? 0) + 1;
  group.shifts++;
  group.completeShiftCreditGap += net[0] - net[1];
  scores.push({ seed, target, full: net[0], forcedGate: net[2], never: saved.never, always: saved.always, gatesDiffer });
}
const mean = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
const byTarget = {};
for (const key of Object.keys(disagreement)) {
  const group = scores.filter(r => r.target === key);
  byTarget[key] = { shifts: group.length, firstDisagreementWithPlanner: disagreement[key],
    shiftsWhereLiteralGateWouldChangeAnOnPolicyDecision: group.filter(r => r.gatesDiffer).length,
    fullMinusForcedGate: pairedReserve(group, "full", "forcedGate"),
    fullMinusAlwaysRefit: pairedReserve(group, "full", "always"), fullMinusNeverRefit: pairedReserve(group, "full", "never") };
}
const oldWeights = JSON.parse(readFileSync(new URL("../../docs/data/rally/results.json", import.meta.url))).checkpoint.weights;
const original = { shifts: 0, different: 0, beforeFinalSurvey: 0, surveyWaitsFirst: 0, creditGapOnDifferences: 0 };
for (const [i, config] of surveyCases("retention").entries()) {
  const next = createSurvey(config), old = createSurvey(config);
  let differs = false;
  while (!next.done) {
    const a = chooseSurvey(observeSurvey(next),model), b = chooseRally(observeSurvey(old),oldWeights);
    if (!differs && a !== b) {
      differs = true;
      original.different++;
      if (next.wave < 6) original.beforeFinalSurvey++;
      if (a === "pass") original.surveyWaitsFirst++;
    }
    stepSurvey(next,a);
    stepSurvey(old,b);
  }
  const saved = release.guard.cases[i];
  assert.deepEqual([config.seed,next.net,old.net],[saved.seed,saved.rl,saved.rally]);
  original.shifts++;
  if (differs) original.creditGapOnDifferences += next.net - old.net;
}
console.log(JSON.stringify({ releaseSeed: release.checkpoint.trainingSeed, freshShifts: scores.length, originalVsRally: original,
  waveSeven: { rawBrier: mean(forecasts, "rawBrier"), calibratedBrier: mean(forecasts, "calibratedBrier"),
    errorReductionFromCalibration: pairedReserve(forecasts, "rawBrier", "calibratedBrier") }, byTarget }, null, 2));
