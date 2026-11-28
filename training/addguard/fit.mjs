import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {FLEET_PAIRS} from "../../docs/lib/fleetweek.js";
import {closureActions} from "../../docs/lib/closure-world.js";
import {isClosureDecision, prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {moveRecallProposal} from "../../docs/lib/moverecall-policy.js";
import {costProposalFromRecall} from "../../docs/lib/switchcost-policy.js";
import {addGuardFromCost, guardEstimates, guardFeatures, guardHeads, guardRaw, guardRisk} from "../../docs/lib/addguard-policy.js";
import {solveFleetRidge} from "../fleetweek/fit.mjs";
import {visitWeeks} from "../longrepair/fit.mjs";
import {weights as preceding} from "../switchcost/fit.mjs";

const data = new URL("../../docs/data/", import.meta.url);
const source = readFileSync(new URL("switchcost/fit-73.json", data));
const parentDigest = "b40441315416d9866f032759566f1b8f72bf7280c6ecb57c709a7867f8dfb18c";
assert.equal(createHash("sha256").update(source).digest("hex"), parentDigest);
export const weights = {...preceding, parent:JSON.parse(source)};
export const config = {
  seeds:[73, 101, 211], base:1100000000, stride:5000000, calOffset:1000000, selOffset:2000000,
  fitCount:16384, calCount:8192, selCount:16384, families:11, durations:[1, 2, 3, 4, 4, 5, 5],
  fractions:[0, .01, .025, .05, .1, .2, .35], ridge:.1,
};
const round = v => Number(v.toFixed(10));
const targets = ({net, service}) => [Number(net < 0), Number(net > 0), Math.max(0, -net), Math.max(0, net), service];

// Counterfactual suffixes always preserve the order of both trucks. The six
// canonical training starts sample each physical placement once per active board.
function tape(frames) {
  const cache = frames.map(() => ({rows:[], prepared:null}));
  function at(t, positions) {
    const frame = frames[t], board = cache[t], id = 3 * positions[0] + positions[1];
    if (!board.rows[id]) {
      if (isClosureDecision(frame.obs)) board.prepared ??= prepareClosureValues(frame, weights.closure);
      const menu = closureActions({...frame.obs, positions});
      const p = moveRecallProposal(frame, menu, weights, board.prepared);
      const short = menu.find(a => a.id === p.shortId), long = menu.find(a => a.id === p.longId);
      board.rows[id] = {p, short, long};
    }
    return board.rows[id];
  }
  function proposal(t, row) {
    return row.guard ??= addGuardFromCost(frames[t], costProposalFromRecall(frames[t], row.p, weights),
      row.short, row.long, weights);
  }
  function tail(t, positions) {
    if (t === 10) return [0, 0];
    const row = at(t, positions);
    if (!row.tail) {
      const a = row.short, next = tail(t + 1, a.positions);
      row.tail = [a.net + next[0], a.served + next[1]];
    }
    return row.tail;
  }
  function example(t, positions) {
    const row = at(t, positions);
    if (!row.p.rescueEligible) return null;
    const p = proposal(t, row);
    if (!p.guardEligible) return null;
    const s = tail(t, positions), l = tail(t + 1, row.long.positions);
    return {x:p.guardX, net:row.long.net + l[0] - s[0], service:row.long.served + l[1] - s[1]};
  }
  return {at, proposal, example};
}
export function collect(start, count, enriched) {
  const rows = [];
  let weeksWithAdditions = 0;
  visitWeeks(start, count, config.durations, frames => {
    const bank = tape(frames);
    const before = rows.length;
    let positions = [0, 1];
    frames.forEach((frame, t) => {
      if (isClosureDecision(frame.obs)) {
        for (const positionsToTry of enriched ? FLEET_PAIRS : [positions]) {
          const e = bank.example(t, positionsToTry);
          if (e) rows.push(e);
        }
      }
      if (!enriched) positions = bank.at(t, positions).short.positions;
    });
    if (rows.length > before) weeksWithAdditions++;
  });
  return {rows, weeksWithAdditions};
}
function fitHeads(rows) {
  const d = guardFeatures.length, n = rows.length, center = Array(d).fill(0), scale = Array(d).fill(0);
  assert(n > 0, "No parent additions in enriched training");
  for (const {x} of rows) {
    assert.equal(x.length, d);
    for (let j = 1; j < d; j++) center[j] += x[j] / n;
  }
  for (const {x} of rows) for (let j = 1; j < d; j++) scale[j] += (x[j] - center[j]) ** 2 / n;
  for (let j = 0; j < d; j++) {
    center[j] = round(center[j]);
    scale[j] = scale[j] > 1e-16 ? round(Math.sqrt(scale[j])) : 1;
  }
  const gram = Array.from({length:d}, () => new Float64Array(d));
  const rhs = guardHeads.map(() => new Float64Array(d));
  for (const row of rows) {
    const z = row.x.map((v, j) => (v - center[j]) / scale[j]), y = targets(row);
    for (let j = 0; j < d; j++) {
      for (let k = 0; k <= j; k++) gram[j][k] += z[j] * z[k];
      for (let h = 0; h < y.length; h++) rhs[h][j] += z[j] * y[h];
    }
  }
  const solved = solveFleetRidge(gram, rhs, n, config.ridge);
  return {center, scale, heads:Object.fromEntries(guardHeads.map((name, i) => [name, solved[i]]))};
}
function calibrate(rows, model) {
  const raw = rows.map(r => guardRaw(r.x, model)), truth = rows.map(targets), n = rows.length;
  assert(n > 0, "No parent additions in natural calibration");
  return Object.fromEntries(guardHeads.map((name, j) => {
    const mean = truth.reduce((s, y) => s + y[j], 0) / n;
    const predictedMean = raw.reduce((s, y) => s + y[j], 0) / n;
    let xx = 0, xy = 0;
    for (let i = 0; i < n; i++) {
      const d = raw[i][j] - predictedMean;
      xx += d * d;
      xy += d * (truth[i][j] - mean);
    }
    return [name, {mean:round(mean), predictedMean:round(predictedMean),
      slope:round(xx > 1e-12 ? Math.max(0, Math.min(1.5, xy / xx)) : 0)}];
  }));
}
export function thresholds(rows, model) {
  const risk = rows.map(r => guardRisk(guardEstimates(r.x, model))).sort((a, b) => a - b);
  return config.fractions.map(fraction => ({fraction,
    above:fraction ? risk[Math.ceil((1 - fraction) * risk.length) - 1] : null}));
}
export function selectCandidate(candidates) {
  const feasible = candidates.filter(c => c.lossesAvoided > 0 && c.winsForgone === 0 && c.savings > 0 &&
    c.netParent > 0 && c.serviceParent >= 0 && c.serviceShort >= 0);
  const winner = feasible.slice().sort((a, b) => b.lossesAvoided - a.lossesAvoided ||
    b.savings - a.savings || a.settings.fraction - b.settings.fraction)[0] ?? candidates[0];
  return {settings:winner.settings, feasible:feasible.length};
}
function select(start, grid, model) {
  const candidates = grid.map(settings => ({settings, lossesAvoided:0, tiesVetoed:0, winsForgone:0, savings:0,
    actualVetoes:0, netParent:0, serviceParent:0, serviceShort:0}));
  let weeks = 0, weeksWithAdditions = 0;
  const pool = {wins:0, ties:0, losses:0};
  visitWeeks(start, config.selCount, config.durations, frames => {
    const bank = tape(frames);
    let pos = [0, 1], shortService = 0, hasAddition = false;
    for (let t = 0; t < 10; t++) {
      const e = bank.example(t, pos), row = bank.at(t, pos);
      if (e) {
        hasAddition = true;
        pool[e.net > 0 ? "wins" : e.net < 0 ? "losses" : "ties"]++;
        row.risk = guardRisk(guardEstimates(e.x, model));
        for (const c of candidates) {
          if (c.settings.above === null || row.risk <= c.settings.above) continue;
          c[e.net > 0 ? "winsForgone" : e.net < 0 ? "lossesAvoided" : "tiesVetoed"]++;
          c.savings -= e.net;
        }
      }
      shortService += row.short.served;
      pos = row.short.positions;
    }
    let parentNet, parentService;
    for (const c of candidates) {
      let positions = [0, 1], net = 0, service = 0;
      for (let t = 0; t < 10; t++) {
        const row = bank.at(t, positions);
        // If both experts agree, every learned gate takes this same action.
        let action = row.short;
        if (row.short.id !== row.long.id) {
          const p = bank.proposal(t, row);
          if (p.parent.chosenId === row.long.id) action = row.long;
          if (p.guardEligible && c.settings.above !== null) {
            row.risk ??= guardRisk(guardEstimates(p.guardX, model));
            if (row.risk > c.settings.above) {
              action = row.short;
              c.actualVetoes++;
            }
          }
        }
        positions = action.positions;
        net += action.net;
        service += action.served;
      }
      if (c.settings.above === null) { parentNet = net; parentService = service; }
      c.netParent += net - parentNet;
      c.serviceParent += service - parentService;
      c.serviceShort += service - shortService;
    }
    weeks++;
    if (hasAddition) weeksWithAdditions++;
  });
  return {...selectCandidate(candidates), selection:{weeks, weeksWithAdditions, pool, candidates}};
}
function describe({rows, weeksWithAdditions}) {
  return {rows:rows.length, weeksWithAdditions, wins:rows.filter(r => r.net > 0).length,
    ties:rows.filter(r => r.net === 0).length, losses:rows.filter(r => r.net < 0).length};
}
export function fit(seed) {
  const index = config.seeds.indexOf(seed);
  assert(index >= 0, "Unknown continuation fit");
  const trainStart = config.base + index * config.stride;
  const calibrationStart = trainStart + config.calOffset, selectionStart = trainStart + config.selOffset;
  const train = collect(trainStart, config.fitCount, true);
  const model = fitHeads(train.rows);
  const cal = collect(calibrationStart, config.calCount, false);
  model.calibration = calibrate(cal.rows, model);
  return {format:"fleet-addguard-v1", seed, parentSeed:73,
    historicalHashes:{...weights.parent.historicalHashes, parent:parentDigest}, trainStart, calibrationStart, selectionStart,
    fitWeeks:config.families * config.fitCount, calibrationWeeks:config.families * config.calCount,
    fitExamples:describe(train), calibrationExamples:describe(cal), features:guardFeatures,
    ...model, ...select(selectionStart, thresholds(cal.rows, model), model)};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, seed] = process.argv.slice(2);
  assert(["--check", "--write"].includes(mode));
  const dir = new URL("addguard/", data);
  if (mode === "--write") mkdirSync(dir, {recursive:true});
  for (const s of seed === undefined ? config.seeds : [Number(seed)]) {
    const model = fit(s), file = new URL("fit-" + s + ".json", dir), json = JSON.stringify(model) + "\n";
    if (mode === "--write") writeFileSync(file, json);
    else assert.equal(json, readFileSync(file, "utf8"));
    console.log(mode, s, model.fitExamples, model.settings, model.selection.pool);
  }
}
