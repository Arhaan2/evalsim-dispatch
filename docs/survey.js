import { adaptivePlanner, createSurvey, observeSurvey, stepSurvey, stochasticPlanner,
  SURVEY_PATTERNS, SURVEY_SUITE, verifySurvey } from "./lib/survey.js";
import { surveyDecision } from "./lib/survey-policy.js";
import { surveyReferences, surveyWeights } from "./lib/survey-benchmark.js";
import { $, num, scrollTable, table, text } from "./lib/freight-view.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";
import { interval, note, pairedDesk, verifyInWorker } from "./lib/paired-desk.js";

const names = { rl: "Survey agent", stochastic: "Distribution planner", always: "Follow the survey",
  never: "Ignore the survey", rally: "Rally agent", ablated: "Current-only Rally",
  trust: "Trust router", drift: "Drift RL", turns: "Turns RL", closes: "Closes RL", adaptive: "Adaptive planner" };
const world = { create: createSurvey, observe: observeSurvey, step: stepSurvey, verify: verifySurvey };
const policies = weights => weights ? surveyReferences(weights) : { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
const paired = pairedDesk({ suite: SURVEY_SUITE, patterns: SURVEY_PATTERNS, world, policies, names,
  compareKeys: ["rl", "stochastic", "rally"], extraSplits: ["validation", "train", "retention", "archive"] });
const percent = p => num(100 * p, 1) + "%";
const call = action => action === "accept" ? "Book" : "Pass";
const sourceWave = wave => wave >= 6 ? 5 : 2;

function renderSignal(o, weights) {
  const reading = $("signal-reading");
  reading.parentElement.hidden = o.done || !weights;
  if (o.done || !weights) return;
  const d = surveyDecision(o, weights.survey);
  if (o.wave < 3) {
    reading.textContent = "Opening quote. The first delayed survey arrives at wave four.";
  } else if (d.misleading === null) {
    reading.textContent = "The survey of wave " + sourceWave(o.wave) + " gives even odds. It points to neither ending.";
  } else {
    const direction = o.quote.highChance > .5 ? "hot" : "cold";
    reading.textContent = "The survey of wave " + sourceWave(o.wave) + " points " + direction
      + ". The agent puts the chance it points to the wrong ending at " + percent(d.misleading) + ".";
  }
  const recent = $("recent-offers");
  recent.hidden = o.wave < 3;
  if (o.wave >= 3) {
    const signs = [...o.history.slice(sourceWave(o.wave)).map(row => row.high), o.offer.net === o.quote.high];
    const high = signs.filter(Boolean).length;
    recent.textContent = high + " of " + signs.length + " signed offers after the sampled wave were high.";
  }
  $("closing-outlook").textContent = "The agent estimates a " + percent(d.persistence) + " chance of a hot finish.";
  if (!o.slots) {
    $("signal-decision").textContent = "Both slots are booked. You can still follow the forecast.";
    return;
  }
  const planner = stochasticPlanner(o);
  const advantage = d.advantage === 0 ? "Booking and waiting have equal estimated value."
    : (d.advantage > 0 ? "Booking" : "Waiting") + " is worth an estimated " + num(Math.abs(d.advantage), 2) + " extra credits.";
  $("signal-decision").textContent = "The agent would " + call(d.action).toLowerCase() + ". " + advantage + " "
    + (planner === d.action ? "The planner agrees." : "The planner would " + call(planner).toLowerCase() + ".");
}

function disclosure(title, ...contents) {
  const result = document.createElement("details");
  result.append(text("summary", title), ...contents);
  return result;
}

function renderReplay(target, config, weights) {
  paired.renderPair(target, config, weights);
  if (!weights) return;
  const state = createSurvey(config), pattern = SURVEY_PATTERNS[config.family];
  const grid = table(["Wave", "Survey source", "Survey points", "Chance it misleads", "Actual direction", "Agent", "Follow", "Ignore"],
    "Survey reliability forecasts and decisions on the agent’s remaining slots at each wave");
  const rows = grid.createTBody();
  while (!state.done) {
    const o = observeSurvey(state), d = surveyDecision(o, weights.survey);
    const directional = d.misleading !== null, hot = o.quote.highChance > .5;
    const reading = o.wave < 3 ? "Opening quote" : directional ? (hot ? "Hot" : "Cold") : "Even odds";
    const aligned = hot === (pattern.ending === "hot");
    dataRow(rows, [o.wave + 1, o.wave >= 3 ? "Wave " + sourceWave(o.wave) : "—", reading,
      directional ? percent(d.misleading) : "—", directional ? (aligned ? "Correct" : "Misleading") : "—",
      call(d.action), call(surveyDecision(o, weights.always).action), call(surveyDecision(o, weights.never).action)]);
    stepSurvey(state, d.action);
  }
  const details = disclosure("Follow the survey and booking decisions", note("This shift closed " + pattern.ending
    + ". A directional survey misleads if it points away from that ending. The last three columns compare the booking the policies would make with the survey agent’s slots."),
    scrollTable(grid));
  details.id = "survey-trace";
  (target.querySelector("#paired-endings") ?? target).append(details);
}

function matchedSurvey(weights) {
  const section = document.createElement("section");
  section.id = "matched-survey";
  const grid = table(["Sixth offer", "Survey error risk", "Booking", "Actual finish"], "Two matched wave-seven surveys with one different signed offer in their history");
  const body = grid.createTBody(), links = document.createElement("div");
  links.className = "section-links";
  for (const ending of ["cold", "hot"]) {
    const config = { family: "crested-shelf-" + ending, seed: 13300977 };
    const state = createSurvey(config);
    while (state.wave < 6) stepSurvey(state, surveyDecision(observeSurvey(state), weights.survey).action);
    const o = observeSurvey(state), d = surveyDecision(o, weights.survey);
    const sixth = o.history[5].offer.net;
    dataRow(body, [sixth + " credits", percent(d.misleading), call(d.action), ending === "cold" ? "Cold" : "Hot"]);
    const link = text("a", "Replay the " + sixth + "-credit history →");
    link.href = paired.picker.url(config, state.calls.map(row => row.id), "session");
    links.append(link);
  }
  const twins = disclosure("Replay the wave-seven warnings on a matched pair",
    note("These two endings share a seed, an 80% bulletin, a 4-credit offer and one open slot. Only the sixth signed offer differs. The agent passes both 4-credit offers even though its warning changes."),
    scrollTable(grid), links);
  const calls = table(["Second offer", "Survey error risk", "Survey agent", "Planner"], "Two wave-six decisions on a 24-credit load with the same slot, price support and bulletin history");
  const decisions = calls.createTBody(), replayLinks = document.createElement("div");
  replayLinks.className = "section-links";
  for (const config of [{family:"second-lift-cold",seed:13300099}, {family:"second-lift-hot",seed:13300141}]) {
    const state = createSurvey(config);
    while (state.wave < 5) stepSurvey(state, surveyDecision(observeSurvey(state), weights.survey).action);
    const o = observeSurvey(state), d = surveyDecision(o, weights.survey);
    dataRow(decisions,[o.history[1].offer.net + " credits",percent(d.misleading),call(d.action),call(stochasticPlanner(o))]);
    const link = text("a", "Replay the " + call(d.action).toLowerCase() + " at wave six →");
    link.href = paired.picker.url(config, state.calls.map(row => row.id), "session"); replayLinks.append(link);
  }
  section.append(text("h3", "One survey, two bookings"),note("At wave six, these two shifts show the same 40% bulletin, the same 24-credit offer and one open slot. The only difference in signed price history is the second offer. The planner books both. The survey agent books one."),
    scrollTable(calls), replayLinks, twins);
  return section;
}

function calibrationFigure(items) {
  const figure = document.createElement("figure");
  figure.className = "calibration-figure";
  figure.append(text("figcaption", "Mean confidence in the predicted ending and share of correct calls at wave seven. Closer values mean less average overconfidence."));
  for (const { label, confidence, accuracy } of items) {
    const name = text("p", label); name.className = "calibration-model"; figure.append(name);
    for (const [label, value] of [["Confidence", confidence], ["Correct", accuracy]]) {
      const row = document.createElement("div"), track = document.createElement("span"), bar = document.createElement("i");
      row.className = "calibration-line"; track.className = "calibration-track"; track.setAttribute("aria-hidden", "true");
      bar.style.width = 100 * value + "%"; track.append(bar); row.append(text("span", label), track, text("span", percent(value)));
      figure.append(row);
    }
  }
  return figure;
}

function renderEvidence(release, weights) {
  const { comparisons, guard, archive, checks } = release;
  const fresh = comparisons.byStratumEnding, original = guard.comparisons.all;
  const results = table(["Test", "Shifts", "Agent minus planner", "Outcome"],
    "Booking targets, mean net credits per shift and paired 95% uncertainty intervals");
  results.className = "test-results";
  const body = results.createTBody();
  for (const [label, row, passed] of [["Fresh hot-ending drops", fresh["interrupted-drop"].hot, checks.hotDrops],
    ["Fresh cold-ending reversals", fresh.reversal.cold, checks.coldReversals],
    ["Original interrupted drop", original, checks.originalDrop]]) {
    dataRow(body, [label, num(row.count), interval(row.rlMinusStochastic), passed ? "Passed" : "Missed"]);
  }
  const detailed = table(["Markets", "Shifts", "Versus planner", "Versus Rally", "Versus follow", "Versus ignore"],
    "Agent’s mean net credits minus each alternative, including the two independently fitted survey controls");
  const rows = detailed.createTBody();
  for (const [label, row] of [["All fresh", comparisons.all], ["Fresh cold reversals",fresh.reversal.cold],
    ["Fresh hot drops",fresh["interrupted-drop"].hot], ["Fresh hot reversals",fresh.reversal.hot],
    ["Fresh cold drops",fresh["interrupted-drop"].cold], ["Original drop", original],
    ["Earlier cold reversals",archive.comparisons.byStratumEnding.reversal.cold],
    ["Earlier hot drops",archive.comparisons.byStratumEnding["interrupted-drop"].hot]]) {
    dataRow(rows, [label, num(row.count), interval(row.rlMinusStochastic), interval(row.rlMinusRally),
      interval(row.rlMinusAlways), interval(row.rlMinusNever)]);
  }
  const totals = table(["Fresh market", ...Object.values(names)], "Mean net credits for each reference and fresh market");
  const metrics = totals.createTBody();
  for (const [family, row] of Object.entries(comparisons.byFamily)) {
    dataRow(metrics, [SURVEY_PATTERNS[family].label, ...Object.keys(names).map(k=>num(row[k],2))]);
  }
  dataRow(metrics, ["All shifts", ...Object.keys(names).map(k=>num(comparisons.all[k],2))]);
  const count = [checks.coldReversals, checks.hotDrops, checks.originalDrop].filter(Boolean).length;
  const lead = text("p", "The survey agent met " + count + " of the three booking targets.");
  lead.className = "result-lead";
  $("scorecard").replaceChildren(lead, scrollTable(results),
    note("The columns compare policies on identical shifts. A fresh planner win requires the full paired 95% interval to exceed zero."),
    originalResult(original, release.protocol.margin),
    disclosure("Compare the survey controls and earlier patterns", note("The follow control uses the current posted odds as its estimate of a hot finish. The ignore control estimates the ending from signed prices alone. Each fits its own booking values. The archive replays the previous Rally test patterns with fresh seeds."), scrollTable(detailed)),
    disclosure("See all reference policies",scrollTable(totals)),
    diagnosticResults(release.diagnostic,archive.diagnostic,release.routing), matchedSurvey(weights), exampleLinks(release.cases, paired.picker.url));
  const target = location.hash.slice(1);
  if (["survey-reliability", "matched-survey"].includes(target)) requestAnimationFrame(() => $(target).scrollIntoView({ behavior: "instant" }));
}

mountDemandDesk({
  suite: SURVEY_SUITE, patterns: SURVEY_PATTERNS, picker: paired.picker, names, policies, world,
  checkpoints: ["survey", "rally", "trust", "closes", "drift", "turns"], weightsFrom: releases => surveyWeights(...releases),
  renderSignal, renderPair: renderReplay, renderEvidence, reportGroups: paired.reportGroups,
  verifyReport: (report, weights) => verifyInWorker(new URL("./lib/survey-report-worker.js", import.meta.url), report, weights),
});

function originalResult(row, margin) {
  const missed = ["Rally","Trust","Drift","Turns"].filter(key => row["rlMinus" + key].interval95[0] <= -margin);
  return note("On the original drop, the survey agent earned " + num(row.rl,2) + " credits per shift and the planner earned " + num(row.stochastic,2)
    + ". " + (missed.length ? "It fell outside the " + num(margin) + "-credit retention margin against " + missed.join(", ") + "." : "It kept the earlier agents’ gains within the tolerance.")
    + " Paired differences were "
    + interval(row.rlMinusRally) + " versus Rally, " + interval(row.rlMinusTrust) + " versus Trust, "
    + interval(row.rlMinusDrift) + " versus Drift and " + interval(row.rlMinusTurns) + " versus Turns.");
}

function diagnosticResults(diagnostic, archive, routing) {
  const section = document.createElement("section");
  section.id = "survey-reliability";
  const { forecasts } = diagnostic.byWave[6];
  const warning = diagnostic.warning.all;
  const score = x => x.toFixed(3);
  const band = p => score(p.delta) + " [" + p.interval95.map(score).join(", ") + "]";
  section.append(text("h3", "Does confidence match the outcome?"),
    note("The training protocol fixed wave seven for this test. By then the agent has seen seven signed offers and a new survey of wave five."),
    calibrationFigure([{ label: "Survey agent", ...forecasts.rl }, { label: "Previous Rally agent", ...forecasts.rally }]),
    note("The survey agent " + (diagnostic.calibrationPass ? "passed" : "missed") + " the closing forecast test. Its mean squared probability error was "
      + score(forecasts.rl.brier) + ", compared with " + score(forecasts.rally.brier) + " for Rally and 0.250 for a 50/50 forecast. Lower error is better."));
  const warningTable = table(["Wave-seven survey", "Readings", "Actually misleading", "Predicted risk", "Ranking (AUC)", "Error reduction vs. 50/50", "Versus posted odds", "Versus ignore"],
    "Measured direction errors and model scores on nonneutral wave-seven bulletins");
  const body = warningTable.createTBody();
  for (const [label, r] of [["All directions", warning], ["Points hot", diagnostic.warning.hotSignal], ["Points cold", diagnostic.warning.coldSignal],
    ["Earlier Rally patterns", archive.warning.all]]) {
    if (r.count) dataRow(body, [label, num(r.count), percent(r.baseRate), percent(r.riskMean), r.auc === null ? "—" : score(r.auc), band(r.gainVsChance), band(r.gainVsPosted), band(r.gainVsNever)]);
  }
  const errors = table(["Fresh forecast", "Confidence", "Accuracy", "Probability error"],
    "Confidence, accuracy and mean squared probability error across the full set of fresh shifts at wave seven");
  const metrics = errors.createTBody();
  for (const key of ["rl","rally","always","never"]) {
    const r = forecasts[key];
    dataRow(metrics,[names[key],percent(r.confidence),percent(r.accuracy),score(r.brier)]);
  }
  const arcs = table(["Wave", "Survey agent error", "Rally error", "Follow error", "Ignore error"], "Mean squared closing probability errors on each wave");
  const timed = arcs.createTBody();
  diagnostic.byWave.forEach(({wave, forecasts: r})=>dataRow(timed,[wave,...["rl","rally","always","never"].map(k=>score(r[k].brier))]));
  const gainGrid = table(["Comparator", "Reduction in closing forecast error [95% interval]"], "Paired Brier error reductions on fresh wave-seven forecasts");
  const gains = gainGrid.createTBody();
  for (const [label,k] of [["Previous Rally","vsRally"],["50/50 forecast","vsChance"],["Follow the survey","vsAlways"],["Ignore the survey","vsNever"]])
    dataRow(gains,[label,band(diagnostic.gains[k])]);
  section.append(disclosure("Inspect closing forecast errors and uncertainty",scrollTable(errors),scrollTable(gainGrid),
    note("A pass requires a smaller absolute gap between confidence and accuracy than Rally, and a positive lower bound for error reduction against both Rally and a 50/50 forecast."),
    scrollTable(arcs)), text("h3","Which surveys pointed to the wrong ending?"),
    note("Of " + num(warning.count) + " directional readings, " + num(warning.misleadingCount)
      + " pointed away from the eventual close. The agent flagged " + num(warning.flagged) + " as more likely wrong than right. "
      + num(warning.flaggedWrong) + " of its flags were correct. A further " + num(diagnostic.warning.neutralCount) + " readings gave even odds."),
    note("The survey warning " + (diagnostic.warningPass ? "passed" : "missed") + " its separate test. Its ranking score was " + score(warning.auc)
      + " [" + warning.auc95.map(score).join(", ") + "], where 0.500 is chance. Its error reduction against a 50/50 warning was " + band(warning.gainVsChance) + "."),
    note("Against the control that ignores the survey, warning error reduction was " + band(warning.gainVsNever)
      + ". " + (warning.gainVsNever.interval95[0] > 0 ? "Using the survey improved warning accuracy under the squared-error measure." : warning.gainVsNever.interval95[1] < 0
        ? "The signed-offers-only control predicted wrong directions more accurately under the squared-error measure." : "The interval includes zero, so a benefit from the survey input itself remains uncertain.")),
    disclosure("Compare hot and cold readings", scrollTable(warningTable),
      note("A warning passes when the 95% lower bound exceeds 0.500 for ranking and zero for error reduction against 50/50. The earlier-pattern row uses the previous Rally markets with fresh seeds.")));
  const routeTable = table(["Survey direction at closing", "Available decisions", "Controls disagree", "Agent follows", "Agent ignores"],
    "Booking choices when the follow and ignore controls disagree on the same observed market and free capacity");
  const routeBody = routeTable.createTBody();
  for (const [label, row] of [["All directional bulletins",routing.all],["Misleading",routing.misleading],["Aligned",routing.aligned]]) {
    dataRow(routeBody,[label,num(row.eligible),num(row.controlsDiffer),num(row.choseAlways),num(row.choseNever)]);
  }
  section.append(disclosure("Which booking did the agent make?",note("Counts begin when a delayed bulletin points hot or cold and a slot is open. Follow and ignore each choose an action on the survey agent’s own observations. The last two columns count only disagreements."),scrollTable(routeTable)));
  return section;
}
