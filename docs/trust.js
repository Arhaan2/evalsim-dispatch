import { adaptivePlanner, createTrust, observeTrust, stepTrust, stochasticPlanner,
  TRUST_PATTERNS, TRUST_SUITE, verifyTrust } from "./lib/trust.js";
import { trustDecision } from "./lib/trust-policy.js";
import { trustReferences, trustWeights } from "./lib/trust-benchmark.js";
import { $, num, scrollTable, signed, table, text } from "./lib/freight-view.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";
import { pairedDesk, interval, note, verifyInWorker } from "./lib/paired-desk.js";

const names = { rl: "Router", binary: "Two-expert router", votes: "Expert-votes router",
  closes: "Closes RL", stochastic: "Distribution planner", drift: "Drift RL", turns: "Turns RL", adaptive: "Adaptive planner" };
const short = { stochastic: "Planner", closes: "Closes", drift: "Drift" };
const world = { create: createTrust, observe: observeTrust, step: stepTrust, verify: verifyTrust };
const policies = weights => weights ? trustReferences(weights) : { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
const paired = pairedDesk({ suite: TRUST_SUITE, patterns: TRUST_PATTERNS, world, policies, names,
  compareKeys: ["rl", "closes", "stochastic"], extraSplits: ["validation", "train", "retention", "archive"] });
const actionWord = action => action === "accept" ? "Book" : "Pass";

function decisionText(d) {
  if (d.status === "capacity") return "Both slots are booked. The shift can only pass.";
  if (d.status === "agreement") return "All three experts agree. " + actionWord(d.action) + " this offer.";
  return "The router chooses to " + actionWord(d.action).toLowerCase() + ". " + d.supporters.map(key => short[key]).join(" and ")
    + (d.supporters.length === 1 ? " supports" : " support") + " this action.";
}

function renderSignal(o, weights) {
  const reading = $("signal-reading");
  reading.parentElement.hidden = o.done || !weights;
  if (o.done || !weights) return;
  const d = trustDecision(o, weights.trust, weights);
  reading.textContent = decisionText(d);
  const detail = $("signal-decision");
  detail.textContent = "";
  if (d.status !== "disagreement") return;
  const others = Object.keys(d.advice).filter(key => d.advice[key] !== d.action);
  const advice = others.map(key => short[key]).join(" and ") + " would " + actionWord(d.advice[others[0]]).toLowerCase() + ". ";
  detail.textContent = advice + (d.advantage === null || d.advantage === 0
    ? "The planner breaks ties and supplies the fallback for unseen decisions."
    : "The estimated return is " + num(Math.abs(d.advantage), 2) + " credits higher for "
      + (d.advantage > 0 ? "booking." : "passing."));
}

function renderReplay(target, config, weights) {
  paired.renderPair(target, config, weights);
  if (!weights) return;
  const details = document.createElement("details");
  details.id = "routing-trace";
  details.append(text("summary", "Follow the router’s eight decisions"));
  const ledger = table(["Wave", "Slots", "Signed credits", "Planner", "Closes", "Drift", "Router"],
    "Advice on the router’s own remaining truck slots and its action at each wave");
  const body = ledger.createTBody();
  const state = createTrust(config);
  while (!state.done) {
    const o = observeTrust(state);
    const d = trustDecision(o, weights.trust, weights);
    const advice = Object.keys(short).map(key => o.slots ? actionWord(d.advice[key]) : "—");
    const reason = { agreement: " · all agree", capacity: " · full", disagreement: " · " + d.supporters.map(key => short[key]).join(" + ") };
    dataRow(body, [o.wave + 1, o.slots, o.offer.net, ...advice, actionWord(d.action) + reason[d.status]]);
    stepTrust(state, d.action);
  }
  details.append(scrollTable(ledger));
  target.append(details);
}

function historyExample(weights) {
  const example = document.createElement("section");
  example.id = "history-example";
  example.append(text("h3", "One offer, two routing decisions"), note("At wave four, both dispatchers have one slot, a 24-credit offer and the same forecast. The planner says pass. Closes and Drift say book. Their earlier signed offers differ."));
  const links = document.createElement("div");
  links.className = "section-links";
  const grid = table(["Earlier offers", "Router", "Estimated gain from booking"], "Two observed histories with the same wave-four offer, quote board and expert recommendations");
  const rows = grid.createTBody();
  for (const config of [{ family: "brief-rally-hot", seed: 11300040 }, { family: "brief-rally-cold", seed: 11300062 }]) {
    const state = createTrust(config);
    while (state.wave < 3) stepTrust(state, trustDecision(observeTrust(state), weights.trust, weights).action);
    const o = observeTrust(state);
    const d = trustDecision(o, weights.trust, weights);
    dataRow(rows, [o.history.map(r => r.offer.net).join(", "), actionWord(d.action), signed(d.advantage) + " credits"]);
    const link = text("a", "Inspect the " + (d.supporters.includes("stochastic") ? "planner-backed pass" : "history-backed booking"));
    link.href = paired.picker.url(config, state.calls.map(call => call.id), "session");
    links.append(link);
  }
  example.append(scrollTable(grid), links);
  return example;
}

function renderEvidence(release, weights) {
  const { comparisons, checks, guard, archive, routing } = release;
  const hot = comparisons.byStratumEnding["interrupted-drop"].hot;
  const reversal = comparisons.byStratum.reversal;
  const original = guard.comparisons.all;
  const passed = [checks.hotDrops, checks.originalDrop, checks.reversals].filter(Boolean).length;
  const lead = text("p", "The router met " + passed + " of the three primary targets.");
  lead.className = "result-lead";
  const summary = note("On the original interrupted drop the router earned " + num(original.rlMinusCloses.delta, 2)
    + " more credits per shift than Closes RL. On fresh hot-ending drops it earned " + signed(hot.rlMinusCloses.delta)
    + " credits per shift versus Closes RL and " + signed(hot.rlMinusStochastic.delta) + " versus the distribution planner. "
    + "The lower bound against the planner was " + signed(hot.rlMinusStochastic.interval95[0]) + ", with a target above −" + num(release.protocol.margin) + ".");
  const results = table(["Test", "Shifts", "Versus planner", "Versus Closes RL", "Outcome"],
    "Mean router advantage in net credits per shift with paired 95% intervals and prespecified test outcomes");
  const rows = results.createTBody();
  function result(label, group, success) {
    dataRow(rows, [label, num(group.count), interval(group.rlMinusStochastic),
      interval(group.rlMinusCloses), success ? "Passed" : "Missed"]);
  }
  result("Fresh hot-ending drops", hot, checks.hotDrops);
  result("Original interrupted drop", original, checks.originalDrop);
  result("Fresh reversals", reversal, checks.reversals);
  result("Earlier hot-ending drops", archive.comparisons.byStratumEnding["interrupted-drop"].hot, checks.archiveHotDrops);
  result("Earlier reversals", archive.comparisons.byStratum.reversal, checks.archiveReversals);
  const older = note("On the original interrupted drop, the router earned " + interval(original.rlMinusDrift)
    + " versus Drift RL and " + interval(original.rlMinusTurns) + " versus Turns RL. The original and earlier pattern tests use new seeds.");
  const reversals = note("On fresh reversals the router and planner were statistically indistinguishable. On the earlier reversal patterns the router kept a " + signed(archive.comparisons.byStratum.reversal.rlMinusStochastic.delta) + " credit advantage over the planner.");
  const rule = note("A win requires a lower interval bound above zero. Retention allows a lower bound above −"
    + num(release.protocol.margin) + " credit. Hot-ending drops require a win over Closes and retention versus the planner. Reversals require a win over the planner and retention versus Closes. On the original drop the router must beat both and retain the earlier Drift and Turns gains.");
  const joint = note(checks.joint ? "All five prespecified checks passed." : "The combined five-check target was missed.");

  const routes = routing.all;
  const routingNote = note("Across " + num(comparisons.all.count) + " fresh shifts, the router faced "
    + num(routes.disagreement) + " decisions with conflicting advice. The experts agreed on "
    + num(routes.agreement) + " other bookings or passes. On " + num(routes.capacity) + " waves the truck was already full.");
  const votes = table(["Decision set", "Disagreements", "Backed by planner", "Backed by Closes", "Backed by Drift"],
    "Router decisions with conflicting advice and number supported by each expert");
  const voteRows = votes.createTBody();
  for (const [label, group] of [["All fresh shifts", routes], ["Fresh hot-ending drops", routing.byStratumEnding["interrupted-drop"].hot],
    ["Original interrupted drop", routing.guard]]) {
    dataRow(voteRows, [label, num(group.disagreement), ...Object.keys(short).map(key => num(group.onDisagreement[key]))]);
  }
  const support = note("Two experts can back the same booking or pass. Each supporting expert gets counted.");
  const controls = document.createElement("details");
  controls.append(text("summary", "What did the third expert and signed history add?"));
  const ablations = table(["Shifts", "Versus two-expert router", "Versus expert-votes router"],
    "Three-expert history router minus matched retrained controls in net credits per shift with 95% paired intervals");
  const ablationRows = ablations.createTBody();
  for (const [label, group] of [["Fresh hot-ending drops", hot], ["Original interrupted drop", original], ["Fresh reversals", reversal]]) {
    dataRow(ablationRows, [label, interval(group.rlMinusBinary), interval(group.rlMinusVotes)]);
  }
  const b = release.binaryChecks;
  controls.append(note("The two-expert router trained with Closes and the planner. Its hot-drop check "
    + (b.hotDrops ? "passed" : "missed") + ", its original-drop check " + (b.originalDrop ? "passed" : "missed")
    + " and its reversal check " + (b.reversals ? "passed." : "missed.")
    + " Reproduce it with --policy binary. The expert-votes router sees current public information and the three experts’ votes. Those votes can carry history."),
    scrollTable(ablations));
  const baselines = document.createElement("details");
  baselines.append(text("summary", "Compare all reference policies"));
  const comparison = table(["Fresh pattern", ...Object.values(names)], "Mean net credits per shift for all released policies on the fresh cases");
  const metrics = comparison.createTBody();
  for (const [family, group] of Object.entries(comparisons.byFamily)) {
    dataRow(metrics, [TRUST_PATTERNS[family].label, ...Object.keys(names).map(key => num(group[key], 2))]);
  }
  dataRow(metrics, ["All fresh shifts", ...Object.keys(names).map(key => num(comparisons.all[key], 2))]);
  baselines.append(scrollTable(comparison));
  $("scorecard").replaceChildren(lead, summary, scrollTable(results), reversals, older, joint, rule,
    note("Brackets show paired 95% intervals that resample complete scenario seeds. Each seed keeps its matched patterns and endings together."),
    text("h3", "When did routing change the booking?"), routingNote, scrollTable(votes), support,
    historyExample(weights), controls, baselines, exampleLinks(release.cases, paired.picker.url));
  if (location.hash === "#history-example") $("history-example").scrollIntoView();
}

mountDemandDesk({
  suite: TRUST_SUITE, patterns: TRUST_PATTERNS, picker: paired.picker, names, checkpoints: ["trust", "closes", "drift", "turns"],
  weightsFrom: releases => trustWeights(...releases), world, policies, renderSignal, renderPair: renderReplay,
  renderEvidence, reportGroups: paired.reportGroups,
  verifyReport: (report, weights) => verifyInWorker(new URL("./lib/trust-report-worker.js", import.meta.url), report, weights),
});
