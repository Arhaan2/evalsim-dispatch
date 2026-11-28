// Re-derive the parent cohort and Friday returns using ordered iterative
// continuations. Check the normal equations, calibrations and every selection
// candidate without importing the fitter, ranking function or selection routine.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {FLEET_PAIRS} from "../../docs/lib/fleetweek.js";
import {closureActions} from "../../docs/lib/closure-world.js";
import {isClosureDecision, prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {switchCostDecision, switchCostProposal} from "../../docs/lib/switchcost-policy.js";
import {addGuardFromCost, guardFeatures} from "../../docs/lib/addguard-policy.js";
import {weights as previousWeights} from "../switchcost/fit.mjs";
import {visitWeeks} from "../longrepair/fit.mjs";

const data = new URL("../../docs/data/", import.meta.url);
const bytes = readFileSync(new URL("switchcost/fit-73.json", data));
const weights = {...previousWeights, parent:JSON.parse(bytes)};
const names = ["loss", "win", "downside", "upside", "service"], seeds = [73, 101, 211];
const durations = [1, 2, 3, 4, 4, 5, 5], fractions = [0, .01, .025, .05, .10, .20, .35];
const near = (x, y, tol = 1e-7) => assert(Math.abs(x - y) <= tol, `${x} differs from ${y}`);
const expected = r => [Number(r.net < 0), Number(r.net > 0), Math.max(0, -r.net), Math.max(0, r.net), r.service];

function boarded(frames) {
  const rows = Array.from({length:10}, () => new Map()), pre = [];
  function row(t, pos) {
    const id = pos.join(",");
    if (rows[t].has(id)) return rows[t].get(id);
    const frame = frames[t], menu = closureActions({...frame.obs, positions:pos});
    if (isClosureDecision(frame.obs)) pre[t] ??= prepareClosureValues(frame, weights.closure);
    const cost = switchCostProposal(frame, menu, weights, pre[t]);
    const short = menu.find(a => a.id === cost.shortId), long = menu.find(a => a.id === cost.longId);
    const parent = switchCostDecision(cost, weights.parent);
    const active = cost.eligible && cost.recallId === cost.shortId && parent.chosenId === cost.longId;
    assert.equal(active, parent.added);
    const x = active ? addGuardFromCost(frame, cost, short, long, weights).guardX : null;
    const result = {x, short, long, incumbent:parent.chosenId === short.id ? short : long};
    rows[t].set(id, result);
    return result;
  }
  function friday(t, first) {
    let net = first.net, service = first.served, positions = first.positions;
    for (let j = t + 1; j < 10; j++) {
      const a = row(j, positions).short;
      positions = a.positions;
      net += a.net;
      service += a.served;
    }
    return {net, service};
  }
  function pairs(enrich) {
    const cases = [];
    let positions = [0, 1];
    frames.forEach((frame, t) => {
      if (isClosureDecision(frame.obs)) {
        for (const start of enrich ? FLEET_PAIRS : [positions]) {
          const r = row(t, start);
          if (!r.x) continue;
          const long = friday(t, r.long), short = friday(t, r.short);
          cases.push({x:r.x, net:long.net - short.net, service:long.service - short.service});
        }
      }
      if (!enrich) positions = row(t, positions).short.positions;
    });
    return cases;
  }
  return {row, pairs};
}
function sample(start, count, enriched) {
  const cases = [];
  let weeksWithAdditions = 0;
  visitWeeks(start, count, durations, frames => {
    const selected = boarded(frames).pairs(enriched);
    if (selected.length) weeksWithAdditions++;
    cases.push(...selected);
  });
  const shape = {rows:cases.length, weeksWithAdditions, wins:cases.filter(r => r.net > 0).length,
    ties:cases.filter(r => r.net === 0).length, losses:cases.filter(r => r.net < 0).length};
  return {cases, shape};
}
function zscore(x, m) { return x.map((v, j) => j ? (v - m.center[j]) / m.scale[j] : 1); }
function headValues(x, m) {
  const z = zscore(x, m);
  return names.map(h => z.reduce((sum, v, j) => sum + m.heads[h][j] * v, 0));
}
function risk(x, m) {
  const predicted = headValues(x, m).map((v, j) => {
    const c = m.calibration[names[j]];
    return c.mean + (v - c.predictedMean) * c.slope;
  });
  const loss = Math.min(1, Math.max(0, predicted[0])), win = Math.min(1, Math.max(0, predicted[1]));
  const mass = Math.max(1, loss + win);
  return Math.max(0, predicted[2]) - Math.max(0, predicted[3]) - 12 * predicted[4] + 12 * (loss / mass) - 18 * (win / mass);
}
function checkFit({cases, shape}, m) {
  assert.deepEqual(shape, m.fitExamples);
  assert.equal(m.features.length, 28);
  assert.deepEqual(m.features, guardFeatures);
  const n = cases.length, d = m.features.length;
  for (let j = 1; j < d; j++) {
    const mean = cases.reduce((sum, r) => sum + r.x[j], 0) / n;
    const scale = Math.sqrt(cases.reduce((sum, r) => sum + (r.x[j] - mean) ** 2, 0) / n);
    near(m.center[j], mean);
    near(m.scale[j], scale > 1e-8 ? scale : 1);
  }
  const errors = names.map(() => new Float64Array(d));
  for (const r of cases) {
    const y = expected(r), predicted = headValues(r.x, m), z = zscore(r.x, m);
    for (let h = 0; h < y.length; h++) for (let j = 0; j < d; j++) errors[h][j] += (y[h] - predicted[h]) * z[j];
  }
  let max = 0;
  names.forEach((h, i) => m.heads[h].forEach((w, j) => {
    max = Math.max(max, Math.abs(errors[i][j] / n - (j ? .1 * w : 0)));
  }));
  assert(max < 1e-6, `Ridge normal equation error ${max}`);
  return max;
}
function checkCalibration({cases, shape}, m) {
  assert.deepEqual(shape, m.calibrationExamples);
  const n = cases.length, pred = cases.map(r => headValues(r.x, m)), truth = cases.map(expected);
  names.forEach((h, j) => {
    const mean = truth.reduce((s, y) => s + y[j], 0) / n, center = pred.reduce((s, y) => s + y[j], 0) / n;
    let xy = 0, xx = 0;
    pred.forEach((p, i) => { const d = p[j] - center; xx += d * d; xy += d * (truth[i][j] - mean); });
    near(m.calibration[h].mean, mean);
    near(m.calibration[h].predictedMean, center);
    near(m.calibration[h].slope, xx > 1e-12 ? Math.min(1.5, Math.max(0, xy / xx)) : 0);
  });
  const risks = cases.map(r => risk(r.x, m)).sort((a, b) => a - b);
  return fractions.map(fraction => ({fraction, above:fraction ? risks[Math.ceil(risks.length * (1 - fraction)) - 1] : null}));
}
function checkSelection(m, settings) {
  const bins = settings.map(() => ({lossesAvoided:0, tiesVetoed:0, winsForgone:0, savings:0, actualVetoes:0,
    netParent:0, serviceParent:0, serviceShort:0}));
  const pool = {wins:0, losses:0, ties:0};
  let totalWeeks = 0, weeksWithAdditions = 0;
  visitWeeks(m.selectionStart, 16384, durations, frames => {
    const bank = boarded(frames), cas = bank.pairs(false);
    for (const r of cas) {
      const score = risk(r.x, m);
      pool[r.net < 0 ? "losses" : r.net > 0 ? "wins" : "ties"]++;
      bins.forEach((b, k) => {
        if (settings[k].above !== null && score > settings[k].above) {
          b[r.net < 0 ? "lossesAvoided" : r.net > 0 ? "winsForgone" : "tiesVetoed"]++;
          b.savings -= r.net;
        }
      });
    }
    const scores = [];
    for (let k = -1; k < settings.length; k++) {
      let pos = [0, 1], service = 0, net = 0;
      for (let t = 0; t < 10; t++) {
        const r = bank.row(t, pos);
        let a = k < 0 ? r.short : r.incumbent;
        if (k >= 0 && r.x && settings[k].above !== null) {
          r.value ??= risk(r.x, m);
          if (r.value > settings[k].above) { a = r.short; bins[k].actualVetoes++; }
        }
        net += a.net; service += a.served; pos = a.positions;
      }
      scores.push({net, service});
    }
    bins.forEach((b, k) => {
      b.netParent += scores[k + 1].net - scores[1].net;
      b.serviceParent += scores[k + 1].service - scores[1].service;
      b.serviceShort += scores[k + 1].service - scores[0].service;
    });
    totalWeeks++;
    if (cas.length) weeksWithAdditions++;
  });
  assert.equal(totalWeeks, m.selection.weeks);
  assert.equal(weeksWithAdditions, m.selection.weeksWithAdditions);
  assert.deepEqual(pool, m.selection.pool);
  bins.forEach((b, i) => {
    const {settings:s, ...fields} = m.selection.candidates[i];
    assert.deepEqual(fields, b); assert.deepEqual(s, settings[i]);
  });
  const allowed = bins.map((b, i) => ({...b, i})).filter(b => b.winsForgone === 0 && b.lossesAvoided > 0 &&
    b.savings > 0 && b.netParent > 0 && Math.min(b.serviceShort, b.serviceParent) >= 0);
  allowed.sort((a, b) => b.lossesAvoided - a.lossesAvoided || b.savings - a.savings || a.i - b.i);
  assert.equal(allowed.length, m.feasible);
  assert.deepEqual(m.settings, settings[allowed[0]?.i ?? 0]);
}
for (const s of process.argv[2] ? [Number(process.argv[2])] : seeds) {
  assert(seeds.includes(s));
  const m = JSON.parse(readFileSync(new URL("addguard/fit-" + s + ".json", data)));
  assert.equal(m.format, "fleet-addguard-v1");
  assert.equal(m.seed, s); assert.equal(m.parentSeed, 73);
  assert.deepEqual(m.historicalHashes, {...weights.parent.historicalHashes, parent:createHash("sha256").update(bytes).digest("hex")});
  assert.equal(m.trainStart, 1100000000 + 5000000 * seeds.indexOf(s));
  assert.equal(m.calibrationStart, m.trainStart + 1000000); assert.equal(m.selectionStart, m.trainStart + 2000000);
  assert.equal(m.fitWeeks, 180224); assert.equal(m.calibrationWeeks, 90112);
  const err = checkFit(sample(m.trainStart, 16384, true), m);
  const settings = checkCalibration(sample(m.calibrationStart, 8192, false), m);
  checkSelection(m, settings);
  console.log("Verified fit", s, m.fitExamples.rows, "enriched Friday pairs, five heads, calibration and all seven rules; max gradient", err.toExponential(2));
}
