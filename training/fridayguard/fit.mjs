import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {FLEET_MISS_PENALTY} from "../../docs/lib/fleetweek.js";
import {closureActions, closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame} from "../../docs/lib/closure-planner.js";
import {isClosureDecision, prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {switchCostDecision, switchCostProposal} from "../../docs/lib/switchcost-policy.js";
import {chooseFridayGuard, fridayGuardProposal, guardEstimates, guardFeatureNames, guardOutcomes} from "../../docs/lib/fridayguard-policy.js";
import {weights as previous} from "../addguard/fit.mjs";
import {CONFIG} from "../longrepair/fit.mjs";
import {fitHeads, treeSettings} from "./boost.mjs";

export const historicalHashes = {
  preposition101:"c60e20d600894b9dd25369d2c6b33966ad4f8717b425cdae2d2c39343d98acd1",
  preposition211:"66d0ad4cea4336fd73d6627bd7f0fd945ee92835040d109d97c8addd2ae9c817",
  parent:"b40441315416d9866f032759566f1b8f72bf7280c6ecb57c709a7867f8dfb18c",
};
function prepositionFit(seed) {
  const bytes = readFileSync(new URL("../../docs/data/preposition/fit-" + seed + ".json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), historicalHashes["preposition" + seed]);
  return JSON.parse(bytes);
}
export const weights = {...previous, preposition101:prepositionFit(101), preposition211:prepositionFit(211)};
export const config = {seeds:[73, 101, 211], base:1300000000, stride:5000000, selectionOffset:1000000,
  fitCount:16384, selectionCount:8192, families:CONFIG.families, starts:[3, 5, 7], durations:[1, 2, 3, 4, 4, 5, 5],
  serviceWeights:[0, .25, 1], netWeights:[0, .25, 1], hurdles:[0, .025, .075]};

export function visitConfigs(start, count, consume) {
  for (const [i, family] of config.families.entries()) for (let j = 0; j < count; j++) {
    const seed = start + i * count + j;
    consume({seed, family, closure:{starts:config.starts, durations:config.durations}});
  }
}

// Before and after the warning all candidates use the same frozen controller.
// Exogenous public frames can be shared across truck positions. Only branch
// values on the same ordered positions and same half-day share a cache entry.
export function warningExamples(c) {
  const tape = closureFrames(c), t = tape.findIndex(obs => obs.incident.status === "warning");
  assert(t >= 0);
  const frames = [], prepared = [];
  function parentAction(epoch, positions) {
    const obs = tape[epoch], frame = frames[epoch] ??= closureFrame(obs);
    if (isClosureDecision(obs)) prepared[epoch] ??= prepareClosureValues(frame, weights.closure);
    const menu = closureActions({...obs, positions});
    const id = switchCostDecision(switchCostProposal(frame, menu, weights, prepared[epoch]), weights.parent).chosenId;
    return menu.find(a => a.id === id);
  }
  let positions = [0, 1];
  for (let epoch = 0; epoch < t; epoch++) positions = parentAction(epoch, positions).positions;
  const obs = {...tape[t], positions}, menu = closureActions(obs), p = fridayGuardProposal(closureFrame(obs), menu, weights);
  if (!p.choices.length) return {epoch:t, defaultId:p.defaultId, choices:[]};
  const cache = tape.map(() => []);
  function tail(epoch, pos) {
    if (epoch === 10) return {friday:0, service:0, net:0};
    const key = 3 * pos[0] + pos[1];
    return cache[epoch][key] ??= value(epoch, parentAction(epoch, pos));
  }
  function value(epoch, action) {
    const future = tail(epoch + 1, action.positions);
    return {friday:Number(epoch >= 8) * action.served + future.friday,
      service:action.served + future.service, net:action.net + future.net};
  }
  const baseline = value(t, menu.find(a => a.id === p.defaultId));
  const choices = p.choices.map(choice => {
    const alternative = value(t, menu.find(a => a.id === choice.id));
    return {...choice, ...Object.fromEntries(guardOutcomes.map(k => [k, alternative[k] - baseline[k]]))};
  });
  return {epoch:t, defaultId:p.defaultId, choices};
}

export function collect(start, count) {
  const weeks = [], byEpoch = Array.from({length:10}, () => ({weeks:0, disagreements:0, alternatives:0}));
  visitConfigs(start, count, c => {
    const week = warningExamples(c), summary = byEpoch[week.epoch];
    summary.weeks++; summary.alternatives += week.choices.length;
    if (week.choices.length) {summary.disagreements++; weeks.push(week);}
  });
  return {weeks, summary:{weeks:config.families.length * count, disagreementWeeks:weeks.length,
    pairedExamples:weeks.reduce((s, w) => s + w.choices.length, 0), byEpoch}};
}

function greater(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function selectCandidate(candidates) {
  const active = candidates.filter(c => c.changed > 0);
  const joint = active.filter(c => c.friday > 0 && c.service >= 0 && c.net >= 0);
  if (!active.length) return {mode:"always-default", feasible:0,
    settings:{alwaysDefault:true, serviceWeight:0, netWeight:0, hurdle:0}};
  const values = joint.length ? c => [c.friday, c.net, c.service] :
    c => [Math.min(c.friday, c.service, c.net / FLEET_MISS_PENALTY), c.friday, c.net];
  const chosen = (joint.length ? joint : active).reduce((a, b) => greater(values(b), values(a)) ? b : a);
  return {mode:joint.length ? "joint" : "active-fallback", feasible:joint.length, settings:chosen.settings};
}
export function selectionGrid() {
  return config.serviceWeights.flatMap(serviceWeight => config.netWeights.flatMap(netWeight =>
    config.hurdles.map(hurdle => ({serviceWeight, netWeight, hurdle}))));
}
export function select(weeks, heads) {
  const candidates = selectionGrid().map(settings => ({settings, changed:0, friday:0, service:0, net:0}));
  for (const week of weeks) {
    const estimates = guardEstimates(week.choices, heads);
    for (const row of candidates) {
      const id = chooseFridayGuard(week.defaultId, estimates, row.settings);
      if (id === week.defaultId) continue;
      const selected = week.choices.find(choice => choice.id === id);
      row.changed++;
      for (const name of guardOutcomes) row[name] += selected[name];
    }
  }
  return {...selectCandidate(candidates), candidates};
}
export function fit(seed) {
  const index = config.seeds.indexOf(seed);
  assert(index >= 0, "Unknown Friday guard fit");
  const trainStart = config.base + index * config.stride, selectionStart = trainStart + config.selectionOffset;
  const training = collect(trainStart, config.fitCount);
  const heads = fitHeads(training.weeks.flatMap(w => w.choices));
  const selection = collect(selectionStart, config.selectionCount);
  const {settings, ...selectionResults} = select(selection.weeks, heads);
  return {format:"fleet-fridayguard-v1", seed, historicalHashes, trainStart, selectionStart, featureNames:guardFeatureNames,
    treeSettings, heads, settings, training:training.summary, selection:{...selection.summary, ...selectionResults}};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, arg] = process.argv.slice(2);
  assert(["--write", "--check"].includes(mode), "Choose --write or --check");
  const dir = new URL("../../docs/data/fridayguard/", import.meta.url);
  if (mode === "--write") mkdirSync(dir, {recursive:true});
  for (const seed of arg === undefined ? config.seeds : [Number(arg)]) {
    const model = fit(seed), bytes = JSON.stringify(model) + "\n", file = new URL("fit-" + seed + ".json", dir);
    if (mode === "--check") assert.equal(readFileSync(file, "utf8"), bytes, "Checkpoint differs");
    else writeFileSync(file, bytes);
    console.log(mode, seed, model.training.pairedExamples, model.selection.mode, model.settings,
      model.selection.candidates.find(c => JSON.stringify(c.settings) === JSON.stringify(model.settings)));
  }
}
