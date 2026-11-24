import {
  adaptivePlanner, createDrift, DRIFT_PATTERNS, DRIFT_SUITE, observeDrift, stepDrift,
  stochasticPlanner, verifyDrift,
} from "./lib/drift.js";
import { chooseDrift } from "./lib/drift-policy.js";
import { chooseReserve } from "./lib/reserve-policy.js";
import { verifyDriftReport } from "./lib/drift-benchmark.js";
import { $, cell, num, renderOffer, scrollTable, shiftUrl, signed, table, text } from "./lib/freight-view.js";

const initial = { family: DRIFT_SUITE.splits.test.families[0], seed: DRIFT_SUITE.splits.test.start };
const names = { rl: "Drift RL", stochastic: "Distribution", adaptive: "Adaptive", legacy: "Reserve RL" };
const refs = Object.keys(names);
let config, shift, weights, imported;

function dataRow(body, values) {
  const row = body.insertRow();
  cell(row, "th", values[0], "row");
  for (const value of values.slice(1)) cell(row, "td", value);
  return row;
}

function checkConfig(family, seed) {
  if (!Object.hasOwn(DRIFT_PATTERNS, family) || !/^\d{1,10}$/.test(seed) || Number(seed) > 0xffffffff) {
    throw new Error("Choose a listed demand pattern and a whole-number seed from 0 to 4294967295.");
  }
  return { family, seed: Number(seed) };
}

function renderDesk() {
  const o = observeDrift(shift);
  renderOffer(o);
  // The ledger uses the quote issued at the time of each signed offer. Future
  // rows use only the outlook currently published to the dispatcher.
  const past = o.history.map(({quote, offer}) => ({quote, net: offer.net}));
  const current = o.done ? [] : [{quote: o.quote, net: o.offer.net}];
  const outlook = o.forecast.map(quote => ({quote, net: null}));
  $("forecast").replaceChildren();
  for (const [i, {quote, net}] of [...past, ...current, ...outlook].entries()) {
    dataRow($("forecast"), [i + 1, quote.low + " / " + quote.high,
      num(100 * quote.highChance) + "%", num(quote.mean, 2), net ?? "Pending"]);
  }
  if (!o.done) {
    $("offer-detail").textContent += " The posted mean for this wave was " + num(o.quote.mean, 2) + " net credits.";
  }
  const score = verifyDrift(shift);
  $("active-config").textContent = "Seed " + config.seed;
  $("current-score").textContent = score.net + " net credits earned · " + score.accepted + (score.accepted === 1 ? " load booked" : " loads booked");
  const url = shiftUrl(config, shift.calls.map(c => c.id), location.hash);
  $("share").href = url;
  history.replaceState(null, "", url);
  if ($("compare").open) renderComparison();
}

function start(settings, actions = []) {
  const next = createDrift(settings);
  for (const action of actions) stepDrift(next, action);
  config = settings;
  shift = next;
  $("family").value = config.family;
  $("seed").value = config.seed;
  renderDesk();
}

function play(action) {
  const old = observeDrift(shift);
  stepDrift(shift, action);
  if (!old.slots) while (!shift.done) stepDrift(shift, "pass");
  renderDesk();
  $("status").textContent = shift.done ? "Shift complete. You earned " + shift.net + " net credits."
    : "Wave " + (old.wave + 1) + (action === "accept" ? " booked." : " passed.") + " Next offer " + observeDrift(shift).offer.net + " credits.";
  if (shift.done) $("again").focus();
  else if ($("accept").disabled) $("pass").focus();
}

function run(decide) {
  const state = createDrift(config);
  while (!state.done) stepDrift(state, decide(observeDrift(state)));
  const score = verifyDrift(state);
  if (score.violations.length) throw new Error("The replay did not reconcile.");
  return { net: score.net, actions: state.calls.map(c => c.id) };
}

function renderComparison() {
  const completed = createDrift(config);
  while (!completed.done) stepDrift(completed, "pass");
  const history = observeDrift(completed).history;
  const importedCase = imported?.cases.find(c => c.family === config.family && c.seed === config.seed);
  const operators = { stochastic: run(stochasticPlanner), adaptive: run(adaptivePlanner) };
  if (weights) {
    operators.rl = run(o => chooseDrift(o, weights.drift));
    operators.legacy = run(o => chooseReserve(o, weights.legacy));
  }
  const columns = [
    { label: "You", actions: shift.calls.map(c => c.id), net: shift.done ? shift.net : "In play" },
    ...(importedCase ? [{ label: "Agent", ...importedCase }] : []),
    ...refs.filter(key => operators[key]).map(key => ({label: names[key], ...operators[key]})),
  ];
  const grid = table(["Wave", "Offer", ...columns.map(c => c.label)], "Matched operator decisions and net credits");
  const body = grid.createTBody();
  for (const [i, entry] of history.entries()) {
    const row = dataRow(body,[i + 1, entry.offer.net, ...columns.map(c =>
      c.actions[i] === "accept" ? "Book" : c.actions[i] === "pass" ? "Pass" : "—")]);
    for (const el of row.cells) if (el.textContent === "Book") el.className = "booked";
  }
  const total = grid.createTFoot().insertRow();
  cell(total, "th", "Net credits", "row").colSpan = 2;
  for (const c of columns) cell(total, "td", c.net);
  const divergence = [];
  if (operators.rl) {
    const gap = operators.rl.net - operators.stochastic.net;
    const lead = text("p", gap ? "Drift RL earned " + Math.abs(gap) + (gap > 0 ? " more" : " fewer") + " net credits than the distribution planner." : "Drift RL and the distribution planner tied on this shift.");
    lead.className = "result-lead";
    divergence.push(lead);
    const first = operators.rl.actions.findIndex((action, i) => action !== operators.stochastic.actions[i]);
    if (first >= 0) {
      const rlBooked = operators.rl.actions[first] === "accept";
      const note = text("p", "At wave " + (first + 1) + ", " + (rlBooked ? "Drift RL" : "the distribution planner") +
        " booked the " + history[first].offer.net + "-credit offer. " + (rlBooked ? "The distribution planner" : "Drift RL") + " kept a slot open.");
      note.className = "result-note";
      divergence.push(note);
    }
  }
  const audit = table(["Wave","Posted high chance","True high chance","Signed credits"], "Full shift forecast audit with hidden generator probabilities");
  const auditBody = audit.createTBody();
  history.forEach((entry, i) => dataRow(auditBody, [i + 1, num(100 * entry.quote.highChance) + "%",
    num(100 * completed.trueHighChances[i]) + "%", entry.offer.net]));
  const note = text("p", DRIFT_PATTERNS[config.family].label + ". " + DRIFT_PATTERNS[config.family].description +
    " True odds are revealed here after replay. Agents saw posted quotes and signed offers.");
  note.className = "description";
  $("comparison").replaceChildren(...divergence, scrollTable(grid), text("h3", "Behind the forecast"), note, scrollTable(audit));
}

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
  const links = document.createElement("div");
  links.className = "examples";
  for (const [label, test] of [["Replay an RL win",r=>r.rl>r.stochastic],["Replay a tie",r=>r.rl===r.stochastic],["Replay an RL loss",r=>r.rl<r.stochastic]]) {
    const row = release.cases.find(test);
    if (row) {
      const link = text("a",label);
      link.href = shiftUrl(row, [], "compare");
      links.append(link);
    }
  }
  $("scorecard").replaceChildren(lead, scrollTable(means), note, label, verdict, scrollTable(outcomes), context, links);
}

async function loadEvidence() {
  async function json(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("The release file was unavailable.");
    return res.json();
  }
  try {
    const [drift, legacy] = await Promise.all([json("./data/drift/results.json"), json("./data/reserve/results.json")]);
    weights = { drift: drift.checkpoint.weights, legacy: legacy.checkpoint.weights };
    renderEvidence(drift);
    $("upload").hidden = false;
    if ($("compare").open) renderComparison();
  } catch {
    $("scorecard").textContent = "The checkpoint or measurements could not be loaded. Reload the page or open the raw results below. You can still play and compare both planners.";
  }
}

async function importReport(file) {
  imported = null;
  $("report-result").replaceChildren();
  if ($("compare").open) renderComparison();
  if (!file) { $("report-status").textContent = ""; return; }
  $("report-file").disabled = true;
  $("report-status").textContent = "Replaying your decisions…";
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose a Drift JSON report under 5 MB.");
    const report = await verifyDriftReport(JSON.parse(await file.text()), weights);
    const grid = table(["Demand", "Your agent", ...Object.values(names)], "Verified mean net credits on your submitted shifts");
    const body = grid.createTBody();
    for (const [family,row] of Object.entries(report.summary.byFamily)) {
      dataRow(body,[DRIFT_PATTERNS[family].label,num(row.mean,2),...refs.map(k=>num(row.references[k].mean,2))]);
    }
    const row = report.summary.all;
    dataRow(body,["All shifts",num(row.mean,2),...refs.map(k=>num(row.references[k].mean,2))]);
    const diff = row.references.stochastic;
    const stats = text("p", "Your agent versus the distribution planner averaged " + signed(diff.delta) + " credits per shift, with "
      + diff.wins + " wins, " + diff.ties + " ties and " + diff.losses + " losses.");
    const pick = text("button","Inspect the first submitted shift");
    pick.type = "button";
    pick.onclick = () => {
      start({family: report.cases[0].family, seed: report.cases[0].seed});
      $("compare").open = true;
      renderComparison();
      $("compare").querySelector("summary").focus();
    };
    imported = report;
    $("report-status").textContent = report.policy + " verified on " + row.shifts + " " + report.split + " shifts.";
    $("report-result").replaceChildren(scrollTable(grid), stats, pick);
    if ($("compare").open) renderComparison();
  } catch (err) {
    $("report-status").textContent = "Could not verify this file. " + err.message;
  } finally { $("report-file").disabled = false; $("report-file").value = ""; }
}

function init() {
  for (const [split, suite] of Object.entries(DRIFT_SUITE.splits)) {
    const group = document.createElement("optgroup");
    group.label = split === "test" ? "Held-out test patterns" : split === "validation" ? "Validation patterns" : "Training patterns";
    for (const family of suite.families) group.append(new Option(DRIFT_PATTERNS[family].label, family));
    $("family").append(group);
  }
  const params = new URL(location.href).searchParams;
  try {
    const settings = checkConfig(params.get("family") ?? initial.family, params.get("seed") ?? String(initial.seed));
    const actions = params.get("actions")?.split(",") ?? [];
    if (actions.length > 8) throw new Error("Too many waves.");
    start(settings, actions);
  } catch {
    start(initial);
    $("status").textContent = "This run link was invalid. Opened a fresh test shift.";
  }
  $("accept").onclick = () => play("accept");
  $("pass").onclick = () => play("pass");
  for (const id of ["reset", "again"]) $(id).onclick = () => {
    start(config);
    $("offer-heading").focus();
    $("status").textContent = "Restarted the same shift.";
  };
  $("case-form").onsubmit = event => {
    event.preventDefault();
    try {
      start(checkConfig($("family").value,$("seed").value));
      $("config").open = false;
      $("offer-heading").focus();
      $("status").textContent = "Loaded shift " + config.seed + ".";
    } catch (err) { $("status").textContent = err.message; }
  };
  $("compare").addEventListener("toggle", () => { if ($("compare").open) renderComparison(); });
  $("report-file").onchange = event => importReport(event.target.files[0]);
  $("session").hidden = false;
  function reveal() {
    if (location.hash === "#compare") {
      $("compare").open = true;
      $("compare").scrollIntoView();
    }
  }
  window.addEventListener("hashchange", reveal);
  reveal();
  loadEvidence();
}

try { init(); }
catch { $("load-status").textContent = "The interactive desk could not start. Reload the page or use the local benchmark guide below."; }
