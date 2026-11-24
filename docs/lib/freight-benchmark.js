import { reserveCalls } from "./reserve.js";
import { pairedReserve } from "./reserve-policy.js";

/** Run a local policy on public observations. Its memory belongs to this one shift. */
async function runCase(world, config, decide) {
  if (typeof decide !== "function") throw new TypeError("Expected a decision function.");
  const state = world.create(config);
  const actions = [];
  while (!state.done) {
    const observation = world.observe(state);
    const id = await decide(observation, reserveCalls(observation));
    world.step(state, id);
    actions.push(id);
  }
  const score = world.verify(state);
  if (score.violations.length) throw new Error("Freight ledger failed to reconcile.");
  return { actions, score };
}

function summarize(rows, referenceKeys, stratum, ending) {
  function group(cases) {
    const mean = key => cases.reduce((sum, row) => sum + row[key], 0) / cases.length;
    const references = {};
    for (const key of referenceKeys) {
      references[key] = { mean: mean(key), ...pairedReserve(cases, "net", key) };
    }
    return { shifts: cases.length, mean: mean("net"), references };
  }
  function grouped(cases, keyOf, summarizeGroup = group) {
    const groups = new Map();
    for (const row of cases) {
      const key = keyOf(row.family);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return Object.fromEntries([...groups].map(([key, members]) => [key, summarizeGroup(members)]));
  }
  const summary = { all: group(rows), byFamily: grouped(rows, family => family) };
  if (stratum) summary.byStratum = grouped(rows, stratum);
  if (ending) {
    summary.byEnding = grouped(rows, ending);
    summary.byStratumEnding = grouped(rows, stratum, members => grouped(members, ending));
  }
  return summary;
}

/** Re-run all comparators so a development split works exactly like the public scorecard. */
async function benchmark(lab, { split = "test", policy, createPolicy, weights }) {
  if (!lab.splits.includes(split)) throw new RangeError("Choose an evaluation split: " + lab.splits.join(", "));
  if (typeof policy !== "string" || !policy.trim() || policy.length > 160) throw new Error("Use a policy name of 1–160 characters.");
  const cases = [];
  const references = Object.entries(lab.references(weights));
  for (const config of lab.cases(split)) {
    const { seed, family } = config;
    try {
      const candidate = await runCase(lab.world, config, createPolicy());
      const row = { seed, family, actions: candidate.actions, net: candidate.score.net };
      for (const [key, decide] of references) {
        const { score } = await runCase(lab.world, config, decide);
        row[key] = score.net;
      }
      cases.push(row);
    } catch (error) {
      throw new Error(family + " shift " + seed + ": " + error.message, { cause: error });
    }
  }
  return { format: lab.format, suite: lab.id, split, policy,
    summary: summarize(cases, references.map(([key]) => key), lab.stratum, lab.ending), cases };
}

function sameJson(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

/** Reconstruct the exact manifest, replay every claimed action, and regenerate all reference scores. */
async function verifyReport(lab, report, weights) {
  if (report?.format !== lab.format || report.suite !== lab.id ||
      !lab.splits.includes(report.split)) throw new Error("Unrecognized report or suite version for " + lab.id + ".");
  const manifest = lab.cases(report.split);
  if (!Array.isArray(report.cases) || report.cases.length !== manifest.length) throw new Error("The report must contain the complete split.");
  for (const [i, config] of manifest.entries()) {
    const row = report.cases[i];
    if (row?.seed !== config.seed || row?.family !== config.family || !Array.isArray(row.actions)) {
      throw new Error("Report case " + (i + 1) + " differs from the frozen manifest.");
    }
  }
  let next = 0;
  const replayed = await benchmark(lab, {
    split: report.split, policy: report.policy, weights,
    createPolicy() {
      const { actions } = report.cases[next++];
      let wave = 0;
      return () => actions[wave++];
    },
  });
  if (!sameJson(replayed, report)) throw new Error("The reported decisions, scores or summary differ from replay.");
  return replayed;
}

export function createFreightBenchmark(config) {
  const lab = { splits: ["validation", "test"], ...config };
  return {
    runCase: (config, decide) => runCase(lab.world, config, decide),
    benchmark: options => benchmark(lab, options),
    verifyReport: (report, weights) => verifyReport(lab, report, weights),
  };
}
