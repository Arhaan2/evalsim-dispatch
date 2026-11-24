import assert from "node:assert/strict";
import { PAID_PATTERNS, paidCases, createPaid, observePaid, stepPaid, verifyPaid } from "../../docs/lib/paid.js";
import { benchmarkPaid, paidReferences } from "../../docs/lib/paid-benchmark.js";
import { choosePaid } from "../../docs/lib/paid-policy.js";

function finish(state, decide) {
  const actions = [];
  while (!state.done) {
    const action = decide(observePaid(state));
    stepPaid(state, action);
    actions.push(action);
  }
  const score = verifyPaid(state);
  assert.deepEqual(score.violations, []);
  assert.equal(score.gross - score.feePaid, score.net);
  return { ...score, actions };
}

export function fitScores(split, model) {
  const rows = new Map();
  for (const config of paidCases(split)) {
    const score = finish(createPaid(config), o => choosePaid(o, model));
    const { stratum, ending } = PAID_PATTERNS[config.family];
    for (const key of ["all", stratum + "/" + ending]) {
      const g = rows.get(key) ?? { count:0, net:0, buys:0 };
      g.count++; g.net += score.net; g.buys += Number(score.bought);
      rows.set(key,g);
    }
  }
  return Object.fromEntries([...rows].map(([key,g]) => [key, { shifts:g.count, mean:g.net/g.count, bought:g.buys }]));
}

function auditAcquisition(rows, refs) {
  const groups = {};
  for (const row of rows) {
    const { stratum, ending } = PAID_PATTERNS[row.family];
    for (const key of ["rl", "planner"]) {
      const decide = refs[key], state = createPaid(row);
      while (observePaid(state).phase !== "survey") stepPaid(state, decide(observePaid(state)));
      const o = observePaid(state), bought = decide(o) === "buy";
      const buy = structuredClone(state);
      stepPaid(buy, "buy"); stepPaid(state, "skip");
      const withInfo = finish(buy, decide), without = finish(state, decide);
      const actual = bought ? withInfo : without;
      assert.equal(row[key], actual.net);
      assert.equal(row.bought[key === "rl" ? 0 : 1], bought);
      const changed = withInfo.actions.some((action,i) => action !== without.actions[i]);
      for (const group of ["all", stratum + "/" + ending]) {
        const bucket = groups[group] ??= {};
        const g = bucket[key] ??= { shifts:0, bought:0, eligible:0, fees:0, gross:0, net:0, buyGain:0, skipGain:0, buyChanged:0, skipChanged:0 };
        g.shifts++; g.bought += Number(bought); g.eligible += Number(o.slots > 0);
        g.fees += actual.feePaid; g.gross += actual.gross; g.net += actual.net;
        g[bought ? "buyGain" : "skipGain"] += withInfo.net - without.net;
        g[bought ? "buyChanged" : "skipChanged"] += Number(changed);
      }
    }
  }
  return groups;
}

export async function evaluateSplit(split, weights) {
  const refs = paidReferences(weights);
  const report = await benchmarkPaid({ split, weights, policy:"Paid survey agent", createPolicy:() => refs.rl });
  const cases = report.cases.map(({ actions, net, gross, feePaid, reading, ...row }) => {
    assert.equal(actions.length,9); assert.equal(row.rl,net); assert.equal(gross-feePaid,net);
    return row;
  });
  return { cases, summary:report.summary, acquisition:auditAcquisition(cases,refs) };
}

export function assess(splits, margin) {
  const lower = (group,key) => group.references[key].interval95[0];
  const cold = split => {
    const g = splits[split].summary.byStratumEnding.reversal.cold;
    return lower(g,"planner") > 0 && ["booking","survey"].every(k => lower(g,k) > -margin);
  };
  const hotDrops = lower(splits.test.summary.byStratumEnding["interrupted-drop"].hot,"planner") > 0;
  const original = splits.retention.summary.all;
  const originalDrop = ["planner","booking","survey","stochastic"].every(k => lower(original,k) > 0)
    && ["rally","trust","drift","turns"].every(k => lower(original,k) > -margin);
  const coldReversals = cold("test"), archiveColdReversals = cold("archive"), surveyArchiveColdReversals = cold("surveyArchive");
  const fresh = splits.test.summary.all;
  return { hotDrops, coldReversals, archiveColdReversals, surveyArchiveColdReversals, originalDrop,
    selectivePurchasing: ["rlNever","rlAlways"].every(k => lower(fresh,k) > 0),
    joint: hotDrops && coldReversals && archiveColdReversals && surveyArchiveColdReversals && originalDrop };
}
