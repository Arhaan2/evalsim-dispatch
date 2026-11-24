// Post-hoc descriptions of the released fit on the public fresh shifts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRally, observeRally, RALLY_PATTERNS, rallyCases, stepRally, stochasticPlanner, verifyRally } from "../../docs/lib/rally.js";
import { rallyDecision } from "../../docs/lib/rally-policy.js";
import { pairedReserve } from "../../docs/lib/reserve-policy.js";
import { mean } from "./evaluate.mjs";

const release = JSON.parse(readFileSync(new URL("../../docs/data/rally/results.json", import.meta.url)));
const cases = rallyCases("test");
assert.equal(release.cases.length, cases.length);
const forecasts = [];
const earlyRally = [];
const disagreements = { coldReversals: {}, hotDrops: {} };

for (const [i, config] of cases.entries()) {
  const { seed, family } = config, pattern = RALLY_PATTERNS[family];
  const truth = Number(pattern.ending === "hot");
  const model = createRally(config), planner = createRally(config);
  let o = observeRally(model), plannerView = observeRally(planner);
  let first = "allActionsAgree", waveSixBrier;
  while (!o.done) {
    const { action, persistence } = rallyDecision(o, release.checkpoint.weights);
    const reference = stochasticPlanner(plannerView);
    if (first === "allActionsAgree" && action !== reference) {
      first = action === "accept" ? "modelBooksPlannerPasses" : "modelPassesPlannerBooks";
    }
    const brier = (persistence - truth) ** 2;
    if (o.wave === 5) waveSixBrier = brier;
    if (o.wave === 6) {
      const confidence = Math.max(persistence, 1 - persistence);
      const accuracy = persistence === 0.5 ? 0.5 : Number((persistence > 0.5) === Boolean(truth));
      forecasts.push({ seed, truth, persistence, confidence, accuracy });
      if (pattern.stem === "narrow-lift") earlyRally.push({ seed, waveSixBrier, waveSevenBrier: brier });
    }
    o = stepRally(model, action);
    plannerView = stepRally(planner, reference);
  }
  // All comparisons below charge the entire shift's realized net credit gap
  // to its group. It is not a counterfactual return for the first action.
  const left = verifyRally(model), right = verifyRally(planner), saved = release.cases[i];
  assert.deepEqual([left.violations, right.violations], [[], []]);
  assert.deepEqual([seed, family, left.net, right.net], [saved.seed, saved.family, saved.rl, saved.stochastic]);
  let target;
  if (pattern.stratum === "reversal" && !truth) target = disagreements.coldReversals;
  if (pattern.stratum === "interrupted-drop" && truth) target = disagreements.hotDrops;
  if (target) {
    const group = target[first] ??= { shifts: 0, totalCreditGap: 0 };
    group.shifts++;
    group.totalCreditGap += left.net - right.net;
  }
}

function calibration(rows) {
  return {
    shifts: rows.length, meanHotForecast: mean(rows, "persistence"), hotFrequency: mean(rows, "truth"),
    meanConfidence: mean(rows, "confidence"), accuracy: mean(rows, "accuracy"),
    excessConfidence95: pairedReserve(rows, "confidence", "accuracy").interval95,
  };
}
console.log(JSON.stringify({
  releaseSeed: release.checkpoint.trainingSeed, freshShifts: cases.length,
  firstDisagreement: disagreements,
  waveSevenCalibration: {
    all: calibration(forecasts),
    forecastAtLeast90Percent: calibration(forecasts.filter(row => row.persistence >= 0.9)),
    forecastAtMost10Percent: calibration(forecasts.filter(row => row.persistence <= 0.1)),
  },
  earlyRallyTwins: {
    shifts: earlyRally.length, waveSixBrier: mean(earlyRally, "waveSixBrier"),
    waveSevenBrier: mean(earlyRally, "waveSevenBrier"),
    waveSevenMinusSix95: pairedReserve(earlyRally, "waveSevenBrier", "waveSixBrier").interval95,
  },
}, null, 2));
