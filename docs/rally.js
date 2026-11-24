import { adaptivePlanner, createRally, observeRally, stepRally, stochasticPlanner,
  RALLY_PATTERNS, RALLY_SUITE, verifyRally } from "./lib/rally.js";
import { rallyDecision } from "./lib/rally-policy.js";
import { rallyReferences, rallyWeights } from "./lib/rally-benchmark.js";
import { $, num, scrollTable, table, text } from "./lib/freight-view.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";
import { interval, note, pairedDesk, verifyInWorker } from "./lib/paired-desk.js";

const names = { rl: "Rally agent", stochastic: "Distribution planner", ablated: "Current-only agent",
  trust: "Trust router", drift: "Drift RL", turns: "Turns RL", closes: "Closes RL", adaptive: "Adaptive planner" };
const world = { create: createRally, observe: observeRally, step: stepRally, verify: verifyRally };
const policies = weights => weights ? rallyReferences(weights) : { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
const paired = pairedDesk({ suite: RALLY_SUITE, patterns: RALLY_PATTERNS, world, policies, names,
  compareKeys: ["rl", "stochastic", "trust"], extraSplits: ["validation", "train", "retention", "archive"] });

const percent = p => num(100 * p, 1) + "%";
const verb = action => action === "accept" ? "book" : "pass";

function renderSignal(o, weights) {
  const reading = $("signal-reading");
  reading.parentElement.hidden = o.done || !weights;
  if (o.done || !weights) return;
  const decision = rallyDecision(o, weights.rally);
  reading.textContent = percent(decision.persistence) + " estimated chance of a hot finish.";
  $("persistence-meter").value = decision.persistence;
  if (!o.slots) {
    $("signal-decision").textContent = "Both slots are booked. You can still follow the forecast.";
    return;
  }
  const action = verb(decision.action);
  const plannerAction = verb(stochasticPlanner(o));
  const margin = Math.abs(decision.advantage);
  const preference = margin > 0 ? (decision.advantage > 0 ? "Booking" : "Passing")
    + " is worth an estimated " + num(margin, 2) + " extra credits." : "Both choices have the same estimated value.";
  $("signal-decision").textContent = "The agent would " + action + ". " + preference
    + (plannerAction === action ? " The planner agrees." : " The planner would " + plannerAction + ".");
}

function replay(config, weights) {
  const state = createRally(config);
  const rows = [];
  while (!state.done) {
    const o = observeRally(state);
    const decision = rallyDecision(o, weights.rally);
    rows.push({ net: o.offer.net, probability: decision.persistence, action: verb(decision.action) });
    stepRally(state, decision.action);
  }
  return rows;
}

function renderReplay(target, config, weights) {
  paired.renderPair(target, config, weights);
  if (!weights) return;
  const pattern = RALLY_PATTERNS[config.family];
  const cold = pattern.stem + "-cold", hot = pattern.stem + "-hot";
  const twin = Object.hasOwn(RALLY_PATTERNS, cold) && Object.hasOwn(RALLY_PATTERNS, hot);
  const details = document.createElement("details");
  details.id = "forecast-trace";
  details.className = "paired-forecast";
  details.append(text("summary", twin ? "Follow the forecasts on both endings" : "Follow the agent’s forecast"));
  if (twin) {
    const cool = replay({ seed: config.seed, family: cold }, weights);
    const warm = replay({ seed: config.seed, family: hot }, weights);
    const grid = table(["Wave", "Cold twin offer", "Hot twin offer", "Estimated hot close on cold twin", "Estimated hot close on hot twin"],
      "Signed net credits and the model’s probability of a hot close on each matched ending");
    const body = grid.createTBody();
    cool.forEach((r, i) => dataRow(body, [i + 1, r.net, warm[i].net, percent(r.probability), percent(warm[i].probability)]));
    details.append(note("Both columns estimate the chance of a hot close after that wave’s signed offer and public survey. They match whenever the public evidence matches."), scrollTable(grid));
  } else {
    const grid = table(["Wave", "Signed credits", "Estimated hot close", "Agent"], "Agent probability estimates and bookings on this shift");
    const body = grid.createTBody();
    replay(config, weights).forEach((r, i) => dataRow(body, [i + 1, r.net, percent(r.probability), r.action === "book" ? "Book" : "Pass"]));
    details.append(scrollTable(grid));
  }
  const pair = target.querySelector("#paired-endings");
  if (pair) pair.append(details);
  else target.append(details);
}

function disclosure(title, ...contents) {
  const box = document.createElement("details");
  box.append(text("summary", title), ...contents);
  return box;
}

function matchedDecision(weights) {
  const section = document.createElement("section");
  section.id = "matched-decision";
  section.append(text("h3", "One earlier offer changes the booking"),
    note("At wave six, these two shifts have the same posted forecasts, the same 24-credit offer and one open slot. The only difference in the signed price history is the second offer."));
  const grid = table(["Earlier offers", "Estimated hot close", "Booking advantage", "Agent"], "A wave-six booking changes when only the second signed price differs");
  const body = grid.createTBody();
  const links = document.createElement("div");
  links.className = "section-links";
  for (const config of [{ family: "quick-recovery-hot", seed: 12300113 }, { family: "quick-recovery-cold", seed: 12300245 }]) {
    const state = createRally(config);
    while (state.wave < 5) stepRally(state, rallyDecision(observeRally(state), weights.rally).action);
    const o = observeRally(state), d = rallyDecision(o, weights.rally);
    dataRow(body, [o.history.map(entry => entry.offer.net).join(", "), percent(d.persistence),
      (d.advantage > 0 ? "+" : "") + num(d.advantage, 2) + " credits", d.action === "accept" ? "Book" : "Pass"]);
    const link = text("a", "Replay the " + verb(d.action) + " at wave six →");
    link.href = paired.picker.url(config, state.calls.map(call => call.id), "session");
    links.append(link);
  }
  section.append(scrollTable(grid), note("Both forecasts put the chance of a hot close above 50%. The agent books when that slot earns more in expectation than waiting."), links);
  return section;
}

function forecastResults(diagnostic) {
  const section = document.createElement("section");
  section.id = "rally-detection";
  const selected = diagnostic.byWave[6];
  const errorTable = table(["Wave", "History model error", "Current-only error", "History accuracy"],
    "Brier error and classification accuracy for a hot close on the full fresh split");
  const errors = errorTable.createTBody();
  for (const r of diagnostic.byWave) dataRow(errors, [r.wave, r.brier.toFixed(4), r.ablatedBrier.toFixed(4), percent(r.accuracy)]);
  const precis = p => (p > 0 ? "+" : "") + p.toFixed(4);
  const difference = d => precis(d.delta) + " [" + d.interval95.map(precis).join(", ") + "]";
  const comparison = table(["Wave-seven forecasts", "Shifts", "Error reduction vs. 50/50", "Error reduction vs. current-only"],
    "Brier error reduction with paired 95% intervals on fresh shifts");
  const body = comparison.createTBody();
  for (const [label, row] of [["All fresh shifts", selected], ["Reversals", diagnostic.byStratum.reversal[6]],
    ["Interrupted drops", diagnostic.byStratum["interrupted-drop"][6]]]) {
    dataRow(body, [label, num(row.count), difference(row.gainVsChance), difference(row.gainVsAblated)]);
  }
  section.append(text("h3", "Could the agent tell whether the rally would last?"),
    note("At wave seven the agent correctly classified " + percent(selected.accuracy) + " of fresh endings. The current-only agent classified " + percent(selected.ablatedAccuracy) + " correctly. The full model’s mean forecast error was " + selected.brier.toFixed(4)
      + ". The current-only model scored " + selected.ablatedBrier.toFixed(4) + ", and an even-odds forecast scores 0.2500. Lower error is better."),
    note("At that wave its average chance of a hot finish was " + percent(selected.pHot) + " on shifts that ended hot and " + percent(selected.pCold) + " on shifts that ended cold."),
    note(diagnostic.waveSevenPass ? "The wave-seven forecast beat both controls on the prespecified error test."
      : "The wave-seven forecast missed the prespecified test for beating both controls."),
    note("The wave-seven survey measures wave five. On the early-rally pair, wave-five demand was stronger on the twin that later cooled. A higher reading can precede a cold finish."),
    disclosure("See forecast errors, uncertainty and earlier waves", scrollTable(comparison),
      note("The full model uses earlier signed offers and surveys. The current-only model uses the current offer and posted odds. Brier error is the squared difference between the predicted probability and the actual ending, averaged across shifts. Positive reductions favor the history model. Accuracy counts a 50/50 call as half correct."),
      scrollTable(errorTable)));
  const link = text("a", "Replay the first matched test pair →");
  const test = RALLY_SUITE.splits.test;
  link.href = paired.picker.url({ family: test.families[0], seed: test.start }, [], "compare");
  const links = document.createElement("div");
  links.className = "section-links";
  links.append(link);
  section.append(links);
  return section;
}

function renderEvidence(release, weights) {
  const { comparisons, guard, archive, checks } = release;
  const fresh = comparisons.byStratumEnding, original = guard.comparisons.all;
  const results = table(["Test", "Shifts", "Agent minus planner", "Outcome"],
    "New agent compared with the distribution-aware planner, in net credits per shift with paired 95% intervals");
  results.className = "test-results";
  const body = results.createTBody();
  for (const [label, group, passed] of [["Fresh cold-ending reversals", fresh.reversal.cold, checks.coldReversals],
    ["Fresh hot-ending drops", fresh["interrupted-drop"].hot, checks.hotDrops],
    ["Original interrupted drop", original, checks.originalDrop]]) {
    dataRow(body, [label, num(group.count), interval(group.rlMinusStochastic), passed ? "Passed" : "Missed"]);
  }
  const followup = table(["Matched shifts", "Shifts", "Agent minus planner", "Agent minus Trust", "Agent minus current-only"],
    "Descriptive differences in mean net credits per shift with paired 95% intervals");
  const groups = followup.createTBody();
  for (const [label, group] of [["All fresh shifts", comparisons.all],
    ["Fresh cold-ending reversals", fresh.reversal.cold], ["Fresh hot-ending drops", fresh["interrupted-drop"].hot],
    ["Fresh hot-ending reversals", fresh.reversal.hot], ["Fresh cold-ending drops", fresh["interrupted-drop"].cold],
    ["Original interrupted drop", original], ["Earlier cold-ending reversals", archive.comparisons.byStratumEnding.reversal.cold],
    ["Earlier hot-ending drops", archive.comparisons.byStratumEnding["interrupted-drop"].hot]]) {
    dataRow(groups, [label, num(group.count), interval(group.rlMinusStochastic), interval(group.rlMinusTrust), interval(group.rlMinusAblated)]);
  }

  const referenceTable = table(["Fresh pattern", ...Object.values(names)], "Mean net credits for all reference agents on fresh patterns");
  const models = referenceTable.createTBody();
  for (const [family, row] of Object.entries(comparisons.byFamily)) {
    dataRow(models, [RALLY_PATTERNS[family].label, ...Object.keys(names).map(key => num(row[key], 2))]);
  }
  dataRow(models, ["All fresh shifts", ...Object.keys(names).map(key => num(comparisons.all[key], 2))]);

  const count = [checks.coldReversals, checks.hotDrops, checks.originalDrop].filter(Boolean).length;
  const lead = text("p", "The rally agent met " + count + " of the three booking targets.");
  lead.className = "result-lead";
  $("scorecard").replaceChildren(lead, scrollTable(results),
    note("Values are average net credits per shift. Brackets give paired 95% intervals. A fresh win requires the entire interval to be above zero."),
    note("The original-drop check also requires the lower bound to stay above −" + num(release.protocol.margin)
      + " credit against three earlier agents. The differences were " + interval(original.rlMinusDrift) + " versus Drift, "
      + interval(original.rlMinusTurns) + " versus Turns and " + interval(original.rlMinusTrust) + " versus Trust."),
    disclosure("Compare endings, earlier patterns and the current-only agent", scrollTable(followup),
      note("The archive reuses earlier Trust patterns with new market draws. Each uncertainty interval resamples whole seeds, keeping matched endings and policies together.")),
    disclosure("Compare all reference agents", scrollTable(referenceTable)), forecastResults(release.diagnostic), matchedDecision(weights),
    exampleLinks(release.cases, paired.picker.url));
  const target = location.hash.slice(1);
  if (["rally-detection", "matched-decision"].includes(target)) {
    requestAnimationFrame(() => $(target).scrollIntoView({ behavior: "instant" }));
  }
}

mountDemandDesk({
  suite: RALLY_SUITE, patterns: RALLY_PATTERNS, picker: paired.picker, names, policies, world,
  checkpoints: ["rally", "trust", "closes", "drift", "turns"], weightsFrom: releases => rallyWeights(...releases),
  renderSignal, renderPair: renderReplay, renderEvidence, reportGroups: paired.reportGroups,
  verifyReport: (report, weights) => verifyInWorker(new URL("./lib/rally-report-worker.js", import.meta.url), report, weights),
});
