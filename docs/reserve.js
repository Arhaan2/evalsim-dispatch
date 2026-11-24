import {
  createReserve, observeReserve, pointPlanner, RESERVE_FAMILIES, stepReserve, stochasticPlanner, verifyReserve,
} from "./lib/reserve.js";
import { chooseReserve, RESERVE_SUITE } from "./lib/reserve-policy.js";
import { verifyReserveReport } from "./lib/reserve-benchmark.js";

import { $, num, signed, text, cell, table, scrollTable, shiftUrl, renderOffer, renderForecast } from "./lib/freight-view.js";

const title = family => family[0].toUpperCase() + family.slice(1);
const forecastNotes = {
  steady: "Every upcoming offer has a fixed net value.",
  surge: "Early contracts give way to spot loads with a chance of a much higher payout.",
  volatile: "Small contracts and high-variance spot offers arrive throughout the shift.",
};
const initial = { seed: RESERVE_SUITE.splits.test.start, family: "surge" };
let config, shift, released, imported;

function readConfig(seed, family) {
  if (!/^\d{1,10}$/.test(seed) || Number(seed) > 0xffffffff || !RESERVE_FAMILIES.includes(family)) {
    throw new Error("Choose a listed demand pattern and a shift seed from 0 to 4294967295.");
  }
  return { seed: Number(seed), family };
}

function renderDesk() {
  const o = observeReserve(shift);
  $("active-config").textContent = title(config.family) + " · seed " + config.seed;
  renderOffer(o);
  renderForecast(o, o.forecast.length
    ? forecastNotes[config.family] + " All amounts are net credits."
    : o.done ? "The shift has closed. Open the operator comparison to inspect the full offer sequence."
      : "This is the last offer. Every unused slot expires after this wave.");
  const score = verifyReserve(shift);
  $("current-score").textContent = score.net + " net credits earned · " + score.accepted + (score.accepted === 1 ? " load booked" : " loads booked");
  const url = shiftUrl(config, shift.calls.map(call => call.id), location.hash);
  $("share").href = url.href;
  history.replaceState(null, "", url);
  if ($("compare").open) renderComparison();
}

function start(settings, actions = []) {
  const state = createReserve(settings);
  actions.forEach(action => stepReserve(state, action));
  config = settings;
  shift = state;
  $("family").value = config.family;
  $("seed").value = String(config.seed);
  $("status").textContent = "";
  renderDesk();
}

function act(id) {
  const old = observeReserve(shift);
  stepReserve(shift, id);
  // With no capacity left, passing is the only legal choice in each remaining wave.
  if (old.slots === 0) while (!shift.done) stepReserve(shift, "pass");
  renderDesk();
  $("status").textContent = (old.slots === 0 ? "Remaining offers passed." : "Wave " + (old.wave + 1) + (id === "accept" ? " booked." : " passed."))
    + (shift.done ? " Final contribution " + shift.net + " credits." : " Next offer " + observeReserve(shift).offer.net + " net credits.");
  if (shift.done) $("again").focus();
  else if (!$("accept").hidden && $("accept").disabled && id === "accept") $("pass").focus();
}

function replay(decide) {
  const state = createReserve(config);
  const actions = [], offers = [];
  while (!state.done) {
    const o = observeReserve(state);
    const id = decide(o);
    offers.push(o.offer.net);
    actions.push(id);
    stepReserve(state, id);
  }
  const result = verifyReserve(state);
  if (result.violations.length) throw new Error("Replay failed the freight verifier.");
  return { actions, offers, net: result.net };
}

function renderComparison() {
  const point = replay(pointPlanner), stochastic = replay(stochasticPlanner);
  const rl = released && replay(o => chooseReserve(o, released.checkpoint.weights));
  const importedCase = imported?.cases.find(c => c.seed === config.seed && c.family === config.family);
  const columns = [
    { label: "You", actions: shift.calls.map(c => c.id), net: shift.done ? shift.net : "In play" },
    ...(importedCase ? [{ label: "Agent", actions: importedCase.actions, net: importedCase.net }] : []),
    ...(rl ? [{ label: "RL", ...rl }] : []),
    { label: "Point", ...point },
    { label: "Dist.", ...stochastic },
  ];
  const el = table(["Wave", "Offer", ...columns.map(c => c.label)], "Booking decisions and total net credits for the same shift");
  const body = el.createTBody();
  point.offers.forEach((offer, i) => {
    const row = body.insertRow();
    cell(row, "th", i + 1, "row");
    cell(row, "td", offer);
    for (const col of columns) {
      const action = col.actions[i];
      const entry = cell(row, "td", action === "accept" ? "Book" : action === "pass" ? "Pass" : "—");
      if (action === "accept") entry.className = "booked";
    }
  });
  const total = el.createTFoot().insertRow();
  cell(total, "th", "Net credits", "row").colSpan = 2;
  columns.forEach(c => cell(total, "td", c.net));
  const note = text("p", "RL uses the released Q-learning checkpoint. Point uses forecast means. Dist. uses the full distribution."
    + (importedCase ? " Agent is your replay-verified local policy." : ""));
  note.className = "result-note";
  $("comparison").replaceChildren(scrollTable(el), note);
  if (rl) {
    const gap = rl.net - point.net;
    const line = text("p", gap === 0 ? "RL and the point planner tied on this shift."
      : "RL earned " + Math.abs(gap) + (gap > 0 ? " more" : " fewer") + " net credits than the point planner on this shift.");
    line.className = "result-lead";
    const firstDifference = rl.actions.findIndex((action, i) => action !== point.actions[i]);
    if (firstDifference !== -1) {
      const rlBooked = rl.actions[firstDifference] === "accept";
      const waiting = rlBooked ? point : rl;
      const bookedLabel = rlBooked ? "RL" : "the point planner";
      const waitedLabel = rlBooked ? "The point planner" : "RL";
      const next = waiting.actions.indexOf("accept", firstDifference + 1);
      const explanation = "At wave " + (firstDifference + 1) + ", " + bookedLabel + " booked the " + point.offers[firstDifference]
        + "-credit offer. " + waitedLabel + " passed"
        + (next === -1 ? " and left the slot unused." : " and next booked " + point.offers[next] + " credits at wave " + (next + 1) + ".");
      const note = text("p", explanation);
      note.className = "result-note";
      $("comparison").prepend(note);
    }
    $("comparison").prepend(line);
  }
}

function renderEvidence(report) {
  const { all, byFamily } = report.comparisons;
  const rows = [...RESERVE_FAMILIES.map(f => [title(f), byFamily[f]]), ["All shifts", all]];
  const means = table(["Demand", "RL", "Point", "Dist."], "Mean net freight credits per held-out shift");
  const body = means.createTBody();
  rows.forEach(([name, result]) => {
    const row = body.insertRow();
    cell(row, "th", name, "row");
    for (const key of ["rl", "planner", "stochastic"]) cell(row, "td", num(result[key], 2));
  });
  const lead = text("p", "Mean net credits per shift across " + num(all.count) + " held-out shifts");
  lead.className = "result-lead";
  const d = all.rlMinusPlanner;
  const delta = text("p", "RL minus point planner averaged " + signed(d.delta) + " credits. The 95% paired bootstrap interval was "
    + signed(d.interval95[0]) + " to " + signed(d.interval95[1]) + ". Against the distribution planner the average difference was "
    + signed(all.rlMinusStochastic.delta) + " credits.");
  delta.className = "result-note";
  const outcomes = table(["Demand", "RL wins", "Ties", "RL losses"], "Paired shift outcomes for RL against the point planner");
  const outcomeBody = outcomes.createTBody();
  rows.forEach(([name, values]) => {
    const row = outcomeBody.insertRow();
    cell(row, "th", name, "row");
    for (const key of ["wins","ties","losses"]) cell(row, "td", values.rlMinusPlanner[key]);
  });
  const detail = document.createElement("details");
  detail.append(text("summary", "Wins, ties and losses against the point planner"), scrollTable(outcomes));
  const examples = document.createElement("div");
  examples.className = "examples";
  for (const [label, test] of [
    ["Replay an RL win", r => r.rl > r.planner],
    ["Replay a tie", r => r.rl === r.planner],
    ["Replay an RL loss", r => r.rl < r.planner],
  ]) {
    const row = report.cases.find(test);
    if (row) {
      const link = text("a", label);
      link.href = shiftUrl(row, [], "compare");
      examples.append(link);
    }
  }
  const patterns = text("p", RESERVE_FAMILIES.map(f => title(f) + " " + signed(byFamily[f].rlMinusPlanner.delta)).join(" · ") + " net credits per shift for RL versus the point planner.");
  patterns.className = "result-note";
  $("scorecard").replaceChildren(lead, scrollTable(means), patterns, delta, detail, examples);
}

async function loadResults() {
  try {
    const response = await fetch("./data/reserve/results.json");
    if (!response.ok) throw new Error("The release file was unavailable.");
    const report = await response.json();
    renderEvidence(report);
    released = report;
    $("upload").hidden = false;
    if ($("compare").open) renderComparison();
  } catch {
    $("scorecard").replaceChildren(text("p", "The released measurements and learned policy could not be loaded. Retry the page or open the raw results below. You can still play and compare both planners."));
  }
}

async function importReport(file) {
  imported = null;
  $("report-result").replaceChildren();
  if ($("compare").open) renderComparison();
  if (!file) {
    $("report-status").textContent = "";
    return;
  }
  $("report-file").disabled = true;
  $("report-status").textContent = "Replaying the submitted shifts…";
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose a Reserve JSON report under 5 MB.");
    const report = await verifyReserveReport(JSON.parse(await file.text()), released.checkpoint.weights);
    imported = report;
    const grid = table(["Demand","Your agent","RL","Point","Dist."], "Verified mean net credits for the imported agent and published operators");
    const body = grid.createTBody();
    for (const [name, row] of [...Object.entries(report.summary.byFamily), ["all shifts", report.summary.all]]) {
      const tr = body.insertRow();
      cell(tr, "th", title(name), "row");
      [row.mean, row.references.rl.mean, row.references.planner.mean, row.references.stochastic.mean].forEach(n => cell(tr, "td", num(n, 2)));
    }
    $("report-status").textContent = report.policy + " verified on " + report.summary.all.shifts + " " + report.split + " shifts.";
    const pair = report.summary.all.references.planner;
    const stats = text("p", "Against the point planner your agent had " + pair.wins + " wins, " + pair.ties + " ties and " + pair.losses + " losses.");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.textContent = "Inspect the first submitted shift";
    pick.addEventListener("click", () => {
      start({ family: report.cases[0].family, seed: report.cases[0].seed });
      $("compare").open = true;
      renderComparison();
      $("compare").querySelector("summary").focus();
    });
    $("report-result").replaceChildren(scrollTable(grid), stats, pick);
    if ($("compare").open) renderComparison();
  } catch (err) {
    $("report-status").textContent = "Could not verify this file. " + err.message;
  } finally {
    $("report-file").disabled = false;
    $("report-file").value = "";
  }
}

function init() {
  const params = new URL(location.href).searchParams;
  const notes = [];
  try {
    const settings = readConfig(params.get("seed") ?? String(initial.seed), params.get("family") ?? initial.family);
    const actions = params.get("actions")?.split(",") ?? [];
    if (actions.length > 8) throw new Error("Too many recorded waves.");
    start(settings, actions);
  } catch {
    start(initial);
    notes.push("This run link was invalid. Opened a fresh surge shift.");
  }
  $("accept").addEventListener("click", () => act("accept"));
  $("pass").addEventListener("click", () => act("pass"));
  for (const id of ["reset", "again"]) $(id).addEventListener("click", () => {
    start(config);
    $("offer-heading").focus();
    $("status").textContent = "Shift restarted with the same offers.";
  });
  $("case-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      start(readConfig($("seed").value, $("family").value));
      $("config").open = false;
      $("offer-heading").focus();
      $("status").textContent = "Loaded the " + title(config.family) + " shift.";
    } catch (err) { $("status").textContent = err.message; }
  });
  $("compare").addEventListener("toggle", () => { if ($("compare").open) renderComparison(); });
  $("report-file").addEventListener("change", e => importReport(e.target.files[0]));
  $("session").hidden = false;
  $("status").textContent = notes.join(" ");
  function revealComparison() {
    if (location.hash === "#compare") {
      $("compare").open = true;
      $("compare").scrollIntoView();
    }
  }
  window.addEventListener("hashchange", revealComparison);
  revealComparison();
  loadResults();
}

try { init(); }
catch { $("load-status").textContent = "The interactive desk could not start. Reload the page or use the local benchmark guide below."; }
