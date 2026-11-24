import {
  adaptivePlanner, createCloses, observeCloses, stepCloses, stochasticPlanner,
  CLOSES_PATTERNS, CLOSES_SUITE, verifyCloses,
} from "./lib/closes.js";
import { chooseCloses, closesThreshold } from "./lib/closes-policy.js";
import { chooseTurns } from "./lib/turns-policy.js";
import { chooseDrift } from "./lib/drift-policy.js";
import { verifyClosesReport } from "./lib/closes-benchmark.js";
import { $, num, scrollTable, signed, table, text } from "./lib/freight-view.js";
import { pairedDesk, interval, note } from "./lib/paired-desk.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";

const names = { rl: "History RL", ablated: "Current-only RL", stochastic: "Distribution planner",
  adaptive: "Adaptive planner", turns: "Prior Turns RL", drift: "Prior Drift RL" };
const strata = { reversal: "Reversals", "interrupted-drop": "Interrupted drops" };
const world = { create: createCloses, observe: observeCloses, step: stepCloses, verify: verifyCloses };
const { picker, renderPair, reportGroups } = pairedDesk({ suite: CLOSES_SUITE, patterns: CLOSES_PATTERNS,
  world, policies, names, compareKeys: ["rl", "ablated", "stochastic"], extraSplits: ["validation", "train", "retention"] });

function renderSignal(o, weights) {
  $("signal-reading").parentElement.hidden = o.done || !weights;
  if (o.done || !weights) return;
  if (!o.slots) {
    $("signal-reading").textContent = "Both truck slots are booked.";
    $("signal-decision").textContent = "";
    return;
  }
  function advice(policy, checkpoint) {
    const action = chooseCloses(o, checkpoint) === "accept" ? "books" : "passes";
    return policy + " " + action + " this offer. Booking threshold " + num(closesThreshold(o, checkpoint), 2) + " credits.";
  }
  $("signal-reading").textContent = advice(names.rl, weights.closes);
  $("signal-decision").textContent = advice(names.ablated, weights.ablated);
}

function policies(weights) {
  const planners = { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
  return weights ? { ...planners, rl: o => chooseCloses(o, weights.closes), ablated: o => chooseCloses(o, weights.ablated),
    turns: o => chooseTurns(o, weights.turns), drift: o => chooseDrift(o, weights.drift) } : planners;
}

function renderEvidence(release) {
  const { comparisons, guard, checks } = release;
  const { all, byStratum, byStratumEnding } = comparisons;
  const reversal = byStratum.reversal;
  const headline = text("p", "On " + num(reversal.count) + " fresh reversals, history RL averaged " + num(reversal.rl, 2)
    + " net credits per shift. The distribution planner earned " + num(reversal.stochastic, 2) + " and current-only RL earned " + num(reversal.ablated, 2) + ".");
  headline.className = "result-lead";
  const verdict = note("History RL scored " + interval(reversal.rlMinusStochastic) + " credits versus the planner. The matched fit without history scored "
    + interval(reversal.ablatedMinusStochastic) + " versus the same planner. Adding history changed earnings by "
    + interval(reversal.rlMinusAblated) + " credits per reversal. " + (checks.reversalHistory
      ? "The interval favors using history." : "The interval leaves the benefit of using history uncertain."));
  const endingsNote = note("Adding history changed reversal earnings by " + signed(byStratumEnding.reversal.cold.rlMinusAblated.delta)
    + " with a cold finish and " + signed(byStratumEnding.reversal.hot.rlMinusAblated.delta) + " with a hot finish.");
  const fresh = table(["Fresh shifts", "Shifts", "History RL credits", "Versus current-only RL", "Versus planner"],
    "History RL mean credits and paired differences with 95% intervals by pattern and closing regime");
  const freshBody = fresh.createTBody();
  const freshRow = (label, group) => dataRow(freshBody, [label, num(group.count), num(group.rl, 2),
    interval(group.rlMinusAblated), interval(group.rlMinusStochastic)]);
  for (const [stratum, endings] of Object.entries(byStratumEnding)) {
    for (const [ending, group] of Object.entries(endings)) {
      freshRow(strata[stratum] + " · " + ending, group);
    }
  }
  freshRow("All fresh shifts", all);

  const retention = table(["Interrupted drops", "Shifts", "Versus planner", "Versus Turns RL", "Versus Drift RL", "Retention"],
    "History RL minus each reference on matched interrupted drops in net credits, with 95% intervals");
  const retentionBody = retention.createTBody();
  function retentionRow(label, g, passed) {
    dataRow(retentionBody, [label, num(g.count), interval(g.rlMinusStochastic), interval(g.rlMinusTurns), interval(g.rlMinusDrift), passed ? "Passed" : "Missed"]);
  }
  retentionRow("Fresh · both endings", byStratum["interrupted-drop"], checks.freshDropRetention);
  for (const [family, g] of Object.entries(guard.byFamily)) retentionRow(CLOSES_PATTERNS[family].label, g, checks.guardRetention[family]);
  const drops = byStratumEnding["interrupted-drop"];
  const oldDrop = guard.byFamily["interrupted-drop"];
  const result = note("On fresh interrupted drops, history RL scored " + signed(byStratum["interrupted-drop"].rlMinusStochastic.delta)
    + " overall versus the planner, " + signed(drops.cold.rlMinusStochastic.delta) + " on cold endings and "
    + signed(drops.hot.rlMinusStochastic.delta) + " on hot endings. On the original interrupted drop, the change was "
    + signed(oldDrop.rlMinusTurns.delta) + " versus prior Turns RL and " + signed(oldDrop.rlMinusDrift.delta) + " versus prior Drift RL.");
  const rule = note((checks.joint ? "The full study target passed. " : "The full study target was missed. ")
    + "Retention requires a positive lower interval bound versus the planner and a lower bound above −"
    + num(release.protocol.retentionMargin) + " credit versus each previous RL agent. The three historical patterns use fresh seeds and are scored separately.");

  const detail = document.createElement("details");
  detail.append(text("summary", "All six agents and planners by test pattern"));
  const grid = table(["Fresh pattern", ...Object.values(names)], "Mean net credits for all six references on every fresh pattern");
  const body = grid.createTBody();
  for (const [family, g] of Object.entries(comparisons.byFamily)) dataRow(body, [CLOSES_PATTERNS[family].label, ...Object.keys(names).map(key => num(g[key], 2))]);
  dataRow(body, ["All fresh shifts", ...Object.keys(names).map(key => num(all[key], 2))]);
  detail.append(scrollTable(grid));
  $("scorecard").replaceChildren(headline, verdict, endingsNote, scrollTable(fresh), text("h3", "Did interrupted-drop gains hold?"), result,
    scrollTable(retention), rule, note("Brackets show paired 95% intervals. Each bootstrap draw keeps a seed’s patterns and both endings together. The estimates apply to these patterns and the released training run."),
    detail, exampleLinks(release.cases, picker.url));
}

mountDemandDesk({
  suite: CLOSES_SUITE, patterns: CLOSES_PATTERNS, picker, names, checkpoints: ["closes", "turns", "drift"],
  weightsFrom: ([current, turns, drift]) => ({ closes: current.checkpoint.weights, ablated: current.checkpoint.ablatedWeights,
    turns: turns.checkpoint.weights, drift: drift.checkpoint.weights }),
  world,
  policies, renderSignal, renderPair, renderEvidence, reportGroups, verifyReport: verifyClosesReport,
});
