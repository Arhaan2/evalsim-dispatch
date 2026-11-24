import assert from "node:assert/strict";
import { benchmarkSurvey, surveyReferences } from "../../docs/lib/survey-benchmark.js";
import { SURVEY_PATTERNS, createSurvey, observeSurvey, surveyCases, stepSurvey, verifySurvey } from "../../docs/lib/survey.js";
import { surveyDecision } from "../../docs/lib/survey-policy.js";
import { rallyDecision } from "../../docs/lib/rally-policy.js";
import { pairedReserve, RESERVE_BOOTSTRAP } from "../../docs/lib/reserve-policy.js";

const mean = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
const groupKey = (stratum, ending) => stratum + "/" + ending;
const accuracy = (p, y) => p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(y));

export function seedScores(split, weights) {
  const groups = new Map();
  let total = 0, count = 0;
  for (const config of surveyCases(split)) {
    const s = createSurvey(config);
    let o = observeSurvey(s);
    while (!o.done) o = stepSurvey(s, surveyDecision(o, weights).action);
    const score = verifySurvey(s);
    assert.deepEqual(score.violations, []);
    const pattern = SURVEY_PATTERNS[config.family], key = groupKey(pattern.stratum, pattern.ending);
    const g = groups.get(key) ?? { sum: 0, n: 0 };
    g.sum += score.net; g.n++; groups.set(key, g);
    total += score.net; count++;
  }
  return { all: total / count, byStratumEnding: Object.fromEntries([...groups].map(([k,g]) => [k,g.sum/g.n])) };
}

export async function scoreSplit(split, weights) {
  const report = await benchmarkSurvey({ split, weights, policy: "Released survey agent", createPolicy: () => surveyReferences(weights).rl });
  function summary(group) {
    const result = { count: group.shifts, rl: group.mean };
    for (const [key, { mean: credits, ...paired }] of Object.entries(group.references)) {
      if (key === "rl") { assert.equal(paired.delta, 0); continue; }
      result[key] = credits;
      result["rlMinus" + key[0].toUpperCase() + key.slice(1)] = paired;
    }
    return result;
  }
  const map = (groups, fn) => Object.fromEntries(Object.entries(groups).map(([key,g]) => [key,fn(g)]));
  const { all, byFamily, byStratum, byEnding, byStratumEnding } = report.summary;
  return { cases: report.cases.map(({ actions, net, ...row }) => row),
    comparisons: { all: summary(all), byFamily: map(byFamily, summary), byStratum: map(byStratum, summary),
      byEnding: map(byEnding, summary), byStratumEnding: map(byStratumEnding, g => map(g, summary)) } };
}

export function assess(fresh, guard, margin) {
  const low = (g,k) => g["rlMinus" + k].interval95[0];
  const g = guard.comparisons.all;
  const checks = { coldReversals: low(fresh.byStratumEnding.reversal.cold, "Stochastic") > 0,
    hotDrops: low(fresh.byStratumEnding["interrupted-drop"].hot, "Stochastic") > 0,
    originalDrop: low(g,"Stochastic") > 0 && ["Rally","Trust","Turns","Drift"].every(k => low(g,k) > -margin) };
  return { ...checks, fresh: Object.values(checks).every(Boolean) };
}

// The probability that a randomly selected misleading reading receives a higher
// risk score than an aligned reading. Equal scores receive half credit.
export function warningAuc(rows) {
  const ranks = [...rows].sort((a,b) => a.risk - b.risk);
  let negatives = 0, positives = 0, wins = 0;
  for (let i = 0; i < ranks.length;) {
    const risk = ranks[i].risk;
    let n = 0, p = 0;
    while (i < ranks.length && ranks[i].risk === risk) {
      if (ranks[i++].wrong) p++; else n++;
    }
    wins += p * (negatives + n / 2);
    positives += p; negatives += n;
  }
  return positives && negatives ? wins / (positives * negatives) : null;
}

const predictors = ["rl","always","never","rally"];
function forecastGroup(rows) {
  return Object.fromEntries(predictors.map(k => {
    const confidence = mean(rows, k + "Confidence"), acc = mean(rows, k + "Accuracy");
    return [k, { brier: mean(rows, k + "Brier"), accuracy: acc, confidence, gap: confidence - acc }];
  }));
}

function warningGroup(rows) {
  if (!rows.length) return { count: 0 };
  const wrong = rows.filter(r => r.wrong), aligned = rows.filter(r => !r.wrong);
  const warned = rows.filter(r => r.risk > 0.5);
  return { count: rows.length, misleadingCount: wrong.length, alignedCount: aligned.length,
    riskMean: mean(rows, "risk"), baseRate: wrong.length/rows.length, brier: mean(rows,"riskBrier"),
    accuracy: mean(rows,"riskAccuracy"), auc: warningAuc(rows), flagged: warned.length,
    flaggedWrong: warned.filter(r => r.wrong).length,
    riskOnWrong: wrong.length ? mean(wrong,"risk") : null, riskOnAligned: aligned.length ? mean(aligned,"risk") : null,
    gainVsChance: pairedReserve(rows, "chanceBrier","riskBrier"),
    gainVsPosted: pairedReserve(rows, "alwaysBrier","riskBrier"),
    gainVsNever: pairedReserve(rows, "neverBrier","riskBrier") };
}

// Sorting individual predictions for every draw is unnecessary. The same
// risk values recur, so resample whole seeds and tally the tied risk ranks.
export function aucInterval(rows) {
  const risks = [...new Set(rows.map(r => r.risk))].sort((a,b) => a-b);
  const rank = new Map(risks.map((v,i) => [v,i]));
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.seed)) grouped.set(r.seed, []);
    grouped.get(r.seed).push([rank.get(r.risk),r.wrong]);
  }
  const clusters = [...grouped].sort(([a],[b]) => a-b).map(([,group]) => group);
  const draws = [];
  let rng = RESERVE_BOOTSTRAP.seed;
  for (let j=0; j<RESERVE_BOOTSTRAP.draws; j++) {
    const aligned = new Uint32Array(risks.length), wrong = new Uint32Array(risks.length);
    for (let i=0; i<clusters.length; i++) {
      rng = (Math.imul(rng,1664525) + 1013904223) >>> 0;
      const picked = clusters[Math.floor(rng / 4294967296 * clusters.length)];
      for (const [bin,label] of picked) (label ? wrong : aligned)[bin]++;
    }
    let negatives=0, positives=0, wins=0;
    for (let i=0; i<risks.length; i++) {
      wins += wrong[i] * (negatives + aligned[i] / 2);
      negatives += aligned[i]; positives += wrong[i];
    }
    if (negatives && positives) draws.push(wins/(positives*negatives));
  }
  assert.ok(draws.length, "AUROC needs both aligned and misleading readings");
  draws.sort((a,b) => a-b);
  return [draws[Math.floor(draws.length*0.025)],draws[Math.ceil(draws.length*0.975)-1]];
}

export function diagnose(split, weights) {
  const waves = Array.from({ length: 8 }, () => []);
  for (const config of surveyCases(split)) {
    const state = createSurvey(config);
    const hot = Number(SURVEY_PATTERNS[config.family].ending === "hot");
    let o = observeSurvey(state);
    while (!o.done) {
      const decision = surveyDecision(o, weights.survey);
      const row = { seed: config.seed, family: config.family, hot, quote: o.quote.highChance, chanceBrier: 0.25 };
      const values = [decision.persistence, surveyDecision(o, weights.always).persistence,
        surveyDecision(o, weights.never).persistence, rallyDecision(o, weights.rally).persistence];
      for (const [i,k] of predictors.entries()) {
        const p = values[i];
        assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
        row[k+"Brier"] = (hot-p)**2;
        row[k+"Confidence"] = Math.max(p,1-p);
        row[k+"Accuracy"] = accuracy(p,hot);
      }
      if (o.wave >= 3 && row.quote !== 0.5) {
        row.risk = decision.misleading;
        assert.ok(Number.isFinite(row.risk) && row.risk >= 0 && row.risk <= 1);
        row.wrong = Number((row.quote > 0.5) !== Boolean(hot));
        row.riskBrier = (row.risk-row.wrong)**2;
        row.riskAccuracy = accuracy(row.risk,row.wrong);
      } else assert.equal(decision.misleading, null);
      waves[o.wave].push(row);
      o = stepSurvey(state,"pass");
    }
  }
  const byWave = waves.map((rows,i) => ({wave:i+1, count:rows.length, forecasts:forecastGroup(rows)}));
  const rows = waves[6], forecasts = byWave[6].forecasts, eligible = rows.filter(r => r.risk !== undefined);
  const warning = { all:warningGroup(eligible), hotSignal:warningGroup(eligible.filter(r => r.quote > 0.5)),
    coldSignal:warningGroup(eligible.filter(r => r.quote < 0.5)), neutralCount:rows.length-eligible.length };
  warning.all.auc95 = aucInterval(eligible);
  const gains = { vsRally: pairedReserve(rows, "rallyBrier", "rlBrier"), vsChance: pairedReserve(rows,"chanceBrier","rlBrier"),
    vsAlways: pairedReserve(rows,"alwaysBrier","rlBrier"), vsNever: pairedReserve(rows,"neverBrier","rlBrier") };
  const calibrationPass = gains.vsRally.interval95[0] > 0 && gains.vsChance.interval95[0] > 0 &&
    Math.abs(forecasts.rl.gap) < Math.abs(forecasts.rally.gap);
  const warningPass = warning.all.gainVsChance.interval95[0] > 0 && warning.all.auc95[0] > 0.5;
  return { byWave, warning, gains, calibrationPass, warningPass };
}

// Compare suggested actions on the same slots, offer and history reached by
// the released policy. Identical advice and a full truck cannot identify which
// survey treatment could have changed the booking.
export function decisionAudit(weights) {
  const tally = () => ({ eligible: 0, controlsAgree: 0, controlsDiffer: 0, choseAlways: 0, choseNever: 0 });
  const all = tally(), aligned = tally(), misleading = tally();
  for (const config of surveyCases("test")) {
    const state = createSurvey(config), hot = SURVEY_PATTERNS[config.family].ending === "hot";
    let o = observeSurvey(state);
    while (!o.done) {
      const choice = surveyDecision(o, weights.survey).action;
      if (o.wave >= 3 && o.slots && o.quote.highChance !== 0.5) {
        const always = surveyDecision(o,weights.always).action, never = surveyDecision(o,weights.never).action;
        for (const g of [all, (o.quote.highChance > 0.5) === hot ? aligned : misleading]) {
          g.eligible++;
          if (always === never) g.controlsAgree++;
          else {
            g.controlsDiffer++;
            g[choice === always ? "choseAlways" : "choseNever"]++;
          }
        }
      }
      o = stepSurvey(state,choice);
    }
  }
  return { all, aligned, misleading };
}
