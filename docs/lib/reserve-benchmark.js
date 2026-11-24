import {
  createReserve, observeReserve, pointPlanner, reserveCalls, stepReserve, stochasticPlanner, verifyReserve,
} from "./reserve.js";
import { chooseReserve, pairedReserve, reserveCases, RESERVE_SUITE } from "./reserve-policy.js";

export const RESERVE_REPORT = "evalsim-reserve-report-v1";

/** Run a local policy on public observations. Its memory belongs to this one shift. */
export async function runReserveCase(config, decide) {
  if (typeof decide !== "function") throw new TypeError("Expected a decision function.");
  const state = createReserve(config);
  const actions = [];
  while (!state.done) {
    const observation = observeReserve(state);
    const id = await decide(observation, reserveCalls(observation));
    stepReserve(state, id);
    actions.push(id);
  }
  const score = verifyReserve(state);
  if (score.violations.length) throw new Error("Freight ledger failed to reconcile.");
  return { actions, score };
}

function summarize(rows) {
  function group(cases) {
    const mean = key => cases.reduce((sum, row) => sum + row[key], 0) / cases.length;
    const references = {};
    for (const key of ["rl", "planner", "stochastic"]) {
      references[key] = { mean: mean(key), ...pairedReserve(cases, "net", key) };
    }
    return { shifts: cases.length, mean: mean("net"), references };
  }
  const families = [...new Set(rows.map(row => row.family))];
  return {
    all: group(rows),
    byFamily: Object.fromEntries(families.map(family => [family, group(rows.filter(row => row.family === family))])),
  };
}

/** Re-run all comparators so a development split works exactly like the public scorecard. */
export async function benchmarkReserve({ split = "test", policy, createPolicy, weights }) {
  if (!["validation", "test"].includes(split)) throw new RangeError("Choose validation or test.");
  if (typeof policy !== "string" || !policy.trim() || policy.length > 160) throw new Error("Use a policy name of 1–160 characters.");
  const cases = [];
  for (const config of reserveCases(split)) {
    const { seed, family } = config;
    try {
      const candidate = await runReserveCase(config, createPolicy());
      const rl = await runReserveCase(config, obs => chooseReserve(obs, weights));
      const planner = await runReserveCase(config, pointPlanner);
      const stochastic = await runReserveCase(config, stochasticPlanner);
      cases.push({ seed, family, actions: candidate.actions, net: candidate.score.net,
        rl: rl.score.net, planner: planner.score.net, stochastic: stochastic.score.net });
    } catch (error) {
      throw new Error(family + " shift " + seed + ": " + error.message, { cause: error });
    }
  }
  return { format: RESERVE_REPORT, suite: RESERVE_SUITE.id, split, policy, summary: summarize(cases), cases };
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
export async function verifyReserveReport(report, weights) {
  if (report?.format !== RESERVE_REPORT || report.suite !== RESERVE_SUITE.id ||
      !["validation", "test"].includes(report.split)) throw new Error("Unrecognized Reserve report or suite version.");
  const manifest = reserveCases(report.split);
  if (!Array.isArray(report.cases) || report.cases.length !== manifest.length) throw new Error("The report must contain the complete split.");
  for (const [i, config] of manifest.entries()) {
    const row = report.cases[i];
    if (row?.seed !== config.seed || row?.family !== config.family || !Array.isArray(row.actions)) {
      throw new Error("Report case " + (i + 1) + " differs from the frozen manifest.");
    }
  }
  let next = 0;
  const replayed = await benchmarkReserve({
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
