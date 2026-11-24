import {
  adaptivePlanner, createDrift, DRIFT_PATTERNS, DRIFT_SUITE, observeDrift, stepDrift,
  stochasticPlanner, verifyDrift,
} from "./lib/drift.js";
import { chooseDrift } from "./lib/drift-policy.js";
import { chooseReserve } from "./lib/reserve-policy.js";
import { benchmarkDrift, verifyDriftReport } from "./lib/drift-benchmark.js";
import { $, num, scrollTable, signed, table, text } from "./lib/freight-view.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";

const names = { rl: "Drift RL", stochastic: "Distribution", adaptive: "Adaptive", legacy: "Reserve RL" };
const refs = Object.keys(names);

function renderEvidence(release) {
  const { all, byFamily } = release.comparisons;
  const groups = [["All shifts", all], ...Object.entries(byFamily).map(([f,v]) => [DRIFT_PATTERNS[f].label,v])];
  const means = table(["Test pattern", ...Object.values(names)], "Mean net credits per held-out shift");
  const body = means.createTBody();
  for (const [label,row] of groups) dataRow(body, [label, ...refs.map(key => num(row[key],2))]);
  const lead = text("p", num(all.count) + " held-out shifts · mean net credits per shift");
  lead.className = "result-lead";
  const coverage = release.legacyCoverage;
  const note = text("p", "Drift RL learned on four other demand patterns. The original Reserve RL checkpoint matched "
    + num(coverage.tableHits) + " of " + num(coverage.eligibleDecisions)
    + " booking decisions in its lookup table. It uses its first-fit rule for unseen states.");
  note.className = "result-note";
  const outcomes = table(["Test pattern", "Mean gap", "95% interval", "Wins", "Ties", "Losses"], "Drift RL minus the distribution planner on identical shifts");
  const ob = outcomes.createTBody();
  for (const [label,r] of groups) {
    const pair = r.rlMinusStochastic;
    dataRow(ob,[label, signed(pair.delta), pair.interval95.map(signed).join(" to "),pair.wins,pair.ties,pair.losses]);
  }
  const label = text("p", "Drift RL versus the distribution planner");
  label.className = "result-lead";
  const pair = all.rlMinusStochastic;
  const verdict = text("p", "The overall gap was " + signed(pair.delta) + " net credits per shift. Its paired 95% interval runs from "
    + signed(pair.interval95[0]) + " to " + signed(pair.interval95[1]) + "."
    + (pair.interval95[0] < 0 && pair.interval95[1] > 0 ? " Either policy could have the higher average return." : ""));
  verdict.className = "result-note";
  const adaptivePair = all.rlMinusAdaptive;
  const context = text("p", "Against the adaptive planner, Drift RL averaged " + signed(adaptivePair.delta)
    + " credits per shift (95% paired interval " + adaptivePair.interval95.map(signed).join(" to ") + "). Intervals resample whole scenario seeds.");
  context.className = "result-note";
  const links = exampleLinks(release.cases);
  $("scorecard").replaceChildren(lead, scrollTable(means), note, label, verdict, scrollTable(outcomes), context, links);
}

mountDemandDesk({
  suite: DRIFT_SUITE, patterns: DRIFT_PATTERNS, names, checkpoints: ["drift","reserve"], verifyReport: (report, w) => verifyDriftReport(report, { drift: w.drift, legacy: w.reserve }), renderEvidence,
  world: { create: createDrift, observe: observeDrift, step: stepDrift, verify: verifyDrift },
  async runFeatured(w) {
    const res = await fetch("./data/turns/results.json");
    if (!res.ok) throw new Error("The Turns RL checkpoint could not be loaded.");
    const weights = (await res.json()).checkpoint.weights;
    const { chooseTurns } = await import("./lib/turns-policy.js");
    return benchmarkDrift({ split: "test", policy: "Turns RL", weights: { drift: w.drift, legacy: w.reserve },
      createPolicy: () => o => chooseTurns(o, weights) });
  },
  policies(weights) {
    const planners = { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
    return weights ? { ...planners, rl: o => chooseDrift(o, weights.drift), legacy: o => chooseReserve(o, weights.reserve) } : planners;
  },
});
