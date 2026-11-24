import {
  adaptivePlanner, createTurns, observeTurns, stepTurns, stochasticPlanner, TURNS_PATTERNS,
  TURNS_SUITE, verifyTurns,
} from "./lib/turns.js";
import { chooseTurns, turnsSignal, turnsThreshold } from "./lib/turns-policy.js";
import { chooseDrift } from "./lib/drift-policy.js";
import { verifyTurnsReport } from "./lib/turns-benchmark.js";
import { $, num, scrollTable, shiftUrl, signed, table, text } from "./lib/freight-view.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";

const names = { rl: "Turns RL", drift: "Prior Drift RL", stochastic: "Distribution", adaptive: "Adaptive" };

function renderSignal(o, weights) {
  $("signal-reading").parentElement.hidden = o.done;
  if (o.done) return;
  const signal = turnsSignal(o);
  const difference = Math.abs(signal.change * 100);
  const direction = difference < .05 ? "level with" : signal.change > 0 ? "above" : "below";
  const distance = direction === "level with" ? "" : num(difference) + " percentage points ";
  $("signal-reading").textContent = "Recent high-offer rate " + num(signal.recentRate * 100) + "%, "
    + distance + direction + " the earlier estimate of " + num(signal.priorRate * 100) + "%.";
  if (!o.slots) {
    $("signal-decision").textContent = "All truck slots are booked.";
  } else if (weights) {
    const threshold = turnsThreshold(o, weights.turns);
    const action = chooseTurns(o, weights.turns) === "accept" ? "books" : "passes";
    $("signal-decision").textContent = "With your current slots, Turns RL " + action + " this offer. Its booking threshold is "
      + num(threshold, 2) + " net credits.";
  } else {
    $("signal-decision").textContent = "";
  }
}

function interval(pair) {
  return signed(pair.delta) + " [" + pair.interval95.map(signed).join(", ") + "]";
}

function reportGroups(groups) {
  const grid = table(["Your agent", "Shifts", "Versus Turns RL", "Versus prior Drift RL", "Versus distribution", "Versus adaptive"],
    "Your agent’s paired net-credit differences by demand pattern group, with 95% intervals");
  const body = grid.createTBody();
  for (const [stratum, group] of Object.entries(groups)) {
    const label = stratum === "reversal" ? "Reversals" : "Interrupted drops";
    dataRow(body, [label, num(group.shifts), ...Object.keys(names).map(key => interval(group.references[key]))]);
  }
  const details = document.createElement("details");
  details.append(text("summary", "Compare your agent on reversals and interrupted drops"), scrollTable(grid));
  return details;
}

function historyEvidence(release) {
  const { all, byStratum } = release.comparisons;
  const { contexts, contextsWithBothActions, firstExample } = release.sensitivity;
  const details = document.createElement("details");
  details.append(text("summary", "Did remembering earlier offers help?"));
  const evidence = text("p", "We refitted the same agent on the same training shifts without turn features. Including history changed earnings by "
    + interval(all.rlMinusAblated) + " credits per shift overall, " + interval(byStratum.reversal.rlMinusAblated)
    + " on reversals and " + interval(byStratum["interrupted-drop"].rlMinusAblated) + " on interrupted drops.");
  const diagnostic = text("p", "With the wave, slots, current offer and forecast held fixed, the agent made different decisions in "
    + num(contextsWithBothActions) + " of " + num(contexts) + " distinct situations. Eight noisy offers limit how precisely an agent can identify a turn.");
  details.append(evidence, diagnostic);
  if (firstExample) {
    const { wave, slots, offer } = firstExample.accept;
    details.append(text("p", "At wave " + (wave + 1) + ", compare two histories with the same " + offer
      + "-credit offer and " + slots + (slots === 1 ? " slot" : " slots") + " left."));
    const links = document.createElement("div");
    links.className = "section-links";
    for (const [action, entry] of Object.entries(firstExample)) {
      const state = createTurns(entry);
      while (state.wave < entry.wave) stepTurns(state, chooseTurns(observeTurns(state), release.checkpoint.weights));
      const link = text("a", action === "accept" ? "Inspect the booking" : "Inspect the pass");
      link.href = shiftUrl(entry, state.calls.map(call => call.id), "session");
      links.append(link);
    }
    details.append(links);
  }
  return details;
}

function renderEvidence(release) {
  const { all, byFamily, byStratum } = release.comparisons;
  const guard = release.guard.comparison;
  const reversal = byStratum.reversal;
  const drops = byStratum["interrupted-drop"];
  const checks = release.checks;
  const headline = text("p", checks.joint
    ? "Turns RL met all four benchmark criteria."
    : "Turns RL met " + [checks.beatsPlanner, checks.repairsReversals, checks.freshDropRetention, checks.originalDropRetention].filter(Boolean).length
      + " of 4 benchmark criteria.");
  headline.className = "result-lead";
  const pooled = all.rlMinusStochastic;
  const conclusion = pooled.interval95[0] > 0 ? "The interval favors Turns RL."
    : pooled.interval95[1] < 0 ? "The interval favors the distribution planner."
      : "The interval includes zero, leaving the overall winner uncertain.";
  const description = text("p", "Across " + num(all.count) + " fresh shifts, Turns RL earned " + num(all.rl, 2)
    + " net credits per shift and the distribution planner earned " + num(all.stochastic, 2) + ". The paired difference was "
    + signed(pooled.delta) + " (95% interval " + pooled.interval95.map(signed).join(" to ") + "). " + conclusion);
  description.className = "result-note";
  const values = table(["Fresh pattern", ...Object.values(names)], "Mean net freight credits per shift for four matched operators");
  const means = values.createTBody();
  for (const [family, row] of Object.entries(byFamily)) {
    dataRow(means, [TURNS_PATTERNS[family].label, ...Object.keys(names).map(key => num(row[key], 2))]);
  }
  dataRow(means, ["All fresh shifts", ...Object.keys(names).map(key => num(all[key], 2))]);

  const tests = table(["Matched shifts", "Count", "Versus prior RL", "Versus distribution", "Versus adaptive"],
    "New minus reference policy in net credits per shift, with paired 95% intervals");
  const testBody = tests.createTBody();
  for (const [label, row] of [["Fresh reversals", reversal], ["Fresh interrupted drops", drops], ["Original drop, new seeds", guard],
    ["Original reversal, new seeds", release.originalReversal.comparison]]) {
    dataRow(testBody, [label, num(row.count), interval(row.rlMinusDrift), interval(row.rlMinusStochastic), interval(row.rlMinusAdaptive)]);
  }
  const margin = release.protocol.retentionMargin;
  const definition = text("p", "Brackets show 95% paired bootstrap intervals grouped by seed. Each difference is Turns RL minus the reference in net credits per shift. The original reversal row is a separate diagnostic. All four fresh test patterns end with low demand. These intervals describe this release and pattern mix.");
  definition.className = "result-note";
  const retention = text("p", "Fresh interrupted drops " + (checks.freshDropRetention ? "met" : "missed") + " the retention criterion. Turns RL scored "
    + interval(drops.rlMinusDrift) + " against prior RL. Retention requires a lower bound above −" + num(margin)
    + " versus prior RL and above zero versus the distribution planner. The original drop pattern on new seeds "
    + (checks.originalDropRetention ? "passed." : "missed this criterion."));
  retention.className = "result-note";
  const resolution = text("p", "On fresh reversals, Turns RL scored " + interval(reversal.rlMinusDrift)
    + " against prior RL and " + interval(reversal.rlMinusStochastic) + " against the distribution planner. The policy refitted without history earned "
    + num(Math.abs(reversal.rlMinusAblated.delta), 2) + (reversal.rlMinusAblated.delta <= 0 ? " more" : " fewer") + " credits per reversal than the full agent.");
  resolution.className = "result-note";
  const controls = document.createElement("details");
  controls.append(text("summary", "Wins, ties and losses against the distribution planner"));
  const wtl = table(["Fresh pattern", "RL wins", "Ties", "RL losses"], "Matched outcomes for Turns RL versus the distribution planner");
  const counts = wtl.createTBody();
  for (const [family, row] of Object.entries(byFamily)) {
    const { wins, ties, losses } = row.rlMinusStochastic;
    dataRow(counts, [TURNS_PATTERNS[family].label, wins, ties, losses]);
  }
  dataRow(counts, ["All fresh shifts", pooled.wins, pooled.ties, pooled.losses]);
  controls.append(scrollTable(wtl));
  $("scorecard").replaceChildren(headline, description, retention, scrollTable(values), text("h3","Reversals and interrupted drops"),
    resolution, scrollTable(tests), definition, historyEvidence(release), controls, exampleLinks(release.cases));
}

mountDemandDesk({
  suite: TURNS_SUITE, patterns: TURNS_PATTERNS, names, checkpoints: ["turns", "drift"],
  verifyReport: verifyTurnsReport, renderSignal, renderEvidence, reportGroups,
  world: { create: createTurns, observe: observeTurns, step: stepTurns, verify: verifyTurns },
  policies(weights) {
    const planners = { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
    return weights ? { ...planners, rl: o => chooseTurns(o, weights.turns), drift: o => chooseDrift(o, weights.drift) } : planners;
  },
});
