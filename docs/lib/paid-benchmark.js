import { PAID_PATTERNS, PAID_SUITE, paidCases, createPaid, observePaid, stepPaid, verifyPaid, paidCalls } from "./paid.js";
import { choosePaid, choosePaidPlanner } from "./paid-policy.js";
import { bookingWeights, bookingReferences } from "./booking-benchmark.js";
import { pairedReserve } from "./reserve-policy.js";

export const PAID_REPORT = "evalsim-paid-report-v1";
export const PAID_EVALUATION_SPLITS = Object.freeze(["validation", "test", "retention", "archive", "surveyArchive"]);
export const paidWeights = (release, ...prior) => ({ ...bookingWeights(...prior), paid: release.checkpoint.weights });

export function paidReferences(weights) {
  const legacy = bookingReferences(weights);
  const skip = decide => o => o.phase === "survey" ? "skip" : decide(o);
  const learnt = mode => o => choosePaid(o, weights.paid, mode);
  const planned = mode => o => choosePaidPlanner(o, weights.paid, mode);
  return { rl: learnt("optional"), planner: planned("optional"), rlNever: learnt("never"), rlAlways: learnt("always"),
    rlFree: learnt("optional"), plannerNever: planned("never"), plannerAlways: planned("always"),
    plannerFree: planned("optional"), stochastic: skip(legacy.stochastic), booking: skip(legacy.rl),
    survey: skip(legacy.survey), rally: skip(legacy.rally), trust: skip(legacy.trust), drift: skip(legacy.drift),
    turns: skip(legacy.turns) };
}

// Free controls run in their own zero-fee world. Every submitted agent pays one credit.
export const paidReferenceFee = key => key === "rlFree" || key === "plannerFree" ? 0 : 1;

export async function runPaidCase(config, decide) {
  if (typeof decide !== "function") throw new TypeError("Expected a policy function.");
  const state = createPaid(config), actions = [];
  while (!state.done) {
    const o = observePaid(state);
    const id = await decide(o, paidCalls(o));
    stepPaid(state, id);
    actions.push(id);
  }
  const score = verifyPaid(state);
  if (score.violations.length) throw new Error("Paid freight ledger failed to reconcile.");
  return { actions, score };
}

function by(cases, keyOf, summarize) {
  const groups = new Map();
  for (const row of cases) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups].map(([key, members]) => [key, summarize(members)]));
}

export function summarizePaid(cases, referenceKeys) {
  const group = rows => {
    const mean = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    const references = Object.fromEntries(referenceKeys.map(key =>
      [key, { mean: mean(key), ...pairedReserve(rows, "net", key) }]));
    return { shifts: rows.length, mean: mean("net"), references };
  };
  const stratum = row => PAID_PATTERNS[row.family].stratum, ending = row => PAID_PATTERNS[row.family].ending;
  return { all: group(cases), byFamily: by(cases, row => row.family, group), byStratum: by(cases, stratum, group),
    byEnding: by(cases, ending, group), byStratumEnding: by(cases, stratum, rows => by(rows, ending, group)) };
}

export async function benchmarkPaid({ split = "test", policy, createPolicy, weights }) {
  if (!PAID_EVALUATION_SPLITS.includes(split)) throw new Error("Unknown paid survey split.");
  if (typeof policy !== "string" || !policy.trim() || policy.length > 160) throw new Error("Use a policy name of 1–160 characters.");
  const refs = Object.entries(paidReferences(weights)), cases = [];
  for (const config of paidCases(split)) {
    const { seed, family } = config;
    try {
      const { actions, score } = await runPaidCase(config, createPolicy());
      const row = { seed, family, actions, net: score.net, gross: score.gross, feePaid: score.feePaid, reading: score.reading, bought: [] };
      for (const [key, decide] of refs) {
        const { score } = await runPaidCase({ ...config, fee: paidReferenceFee(key) }, decide);
        row[key] = score.net;
        row.bought.push(score.bought);
      }
      cases.push(row);
    } catch (error) {
      throw new Error(family + " shift " + seed + ": " + error.message, { cause: error });
    }
  }
  return { format: PAID_REPORT, suite: PAID_SUITE.id, split, policy, summary: summarizePaid(cases, refs.map(([key]) => key)), cases };
}

function sameReport(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b,k) && sameReport(a[k], b[k]));
}

export async function verifyPaidReport(report, weights) {
  if (report?.format !== PAID_REPORT || report.suite !== PAID_SUITE.id || !PAID_EVALUATION_SPLITS.includes(report.split)) {
    throw new Error("Unrecognized paid survey report or suite version.");
  }
  const manifest = paidCases(report.split);
  if (!Array.isArray(report.cases) || report.cases.length !== manifest.length) throw new Error("Incomplete survey split.");
  for (const [i, config] of manifest.entries()) {
    const row = report.cases[i];
    if (row?.family !== config.family || row.seed !== config.seed || !Array.isArray(row.actions) || row.actions.length !== 9) {
      throw new Error("Report differs from the fixed nine-decision manifest.");
    }
  }
  let i = 0;
  const rebuilt = await benchmarkPaid({ policy: report.policy, split: report.split, weights,
    createPolicy() {
      const { actions } = report.cases[i++];
      let n = 0;
      return () => actions[n++];
    } });
  if (!sameReport(rebuilt, report)) throw new Error("Reported survey decisions, fees, readings or scores differ from replay.");
  return rebuilt;
}
