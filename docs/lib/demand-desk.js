import { $, cell, num, renderOffer, scrollTable, shiftUrl, signed, table, text } from "./freight-view.js";

export function dataRow(body, values) {
  const row = body.insertRow();
  cell(row, "th", values[0], "row");
  for (const value of values.slice(1)) cell(row, "td", value);
  return row;
}

export function exampleLinks(cases, urlFor = shiftUrl) {
  const links = document.createElement("div");
  links.className = "examples";
  for (const [label, test] of [["Replay an RL win",r=>r.rl>r.stochastic],["Replay a tie",r=>r.rl===r.stochastic],["Replay an RL loss",r=>r.rl<r.stochastic]]) {
    const row = cases.find(test);
    if (row) {
      const link = text("a",label);
      link.href = urlFor(row, [], "compare");
      links.append(link);
    }
  }
  return links;
}

const splitLabels = { train: "Training patterns", validation: "Validation patterns", test: "Held-out test patterns", retention: "Original interrupted-drop check" };

export function mountDemandDesk({ suite, patterns, world, names, policies, checkpoints, renderEvidence, verifyReport, renderSignal, reportGroups, runFeatured, picker, renderPair, weightsFrom }) {
  const initial = { family: suite.splits.test.families[0], seed: suite.splits.test.start };
  const refs = Object.keys(names);
  const urlFor = picker?.url ?? shiftUrl;
  let config, shift, weights, imported;

  function checkConfig(choice, rawSeed) {
    if (!/^\d{1,10}$/.test(rawSeed) || Number(rawSeed) > 0xffffffff) throw new Error("Use a whole-number seed from 0 to 4294967295.");
    const seed = Number(rawSeed);
    const family = picker ? picker.decode(choice, seed) : choice;
    if (!Object.hasOwn(patterns, family)) throw new Error("Choose a listed shift.");
    return { family, seed };
  }

  function renderDesk() {
    const o = world.observe(shift);
    renderOffer(o);
    renderSignal?.(o, weights);
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
    const score = world.verify(shift);
    $("active-config").textContent = "Seed " + config.seed;
    $("current-score").textContent = score.net + " net credits earned · " + score.accepted + (score.accepted === 1 ? " load booked" : " loads booked");
    const url = urlFor(config, shift.calls.map(c => c.id), location.hash);
    $("share").href = url;
    history.replaceState(null, "", url);
    if ($("compare").open) renderComparison();
  }

  function start(settings, actions = []) {
    const next = world.create(settings);
    for (const action of actions) world.step(next, action);
    if (picker && shift) {
      $("compare").open = false;
      $("comparison").replaceChildren();
      if (location.hash === "#compare") history.replaceState(null, "", urlFor(settings, actions, "session"));
    }
    config = settings;
    shift = next;
    if (picker) picker.select($("family"), config);
    else $("family").value = config.family;
    $("seed").value = config.seed;
    renderDesk();
  }

  function play(action) {
    const old = world.observe(shift);
    world.step(shift, action);
    if (!old.slots) while (!shift.done) world.step(shift, "pass");
    renderDesk();
    $("status").textContent = shift.done ? "Shift complete. You earned " + shift.net + " net credits."
      : "Wave " + (old.wave + 1) + (action === "accept" ? " booked." : " passed.") + " Next offer " + world.observe(shift).offer.net + " credits.";
    if (shift.done) $("again").focus();
    else if ($("accept").disabled) $("pass").focus();
  }

  function run(decide) {
    const state = world.create(config);
    while (!state.done) world.step(state, decide(world.observe(state)));
    const score = world.verify(state);
    if (score.violations.length) throw new Error("The replay did not reconcile.");
    return { net: score.net, actions: state.calls.map(c => c.id) };
  }

  function renderComparison() {
    const completed = world.create(config);
    while (!completed.done) world.step(completed, "pass");
    const history = world.observe(completed).history;
    const importedCase = imported?.cases.find(c => c.family === config.family && c.seed === config.seed);
    const operators = Object.fromEntries(Object.entries(policies(weights)).map(([key, decide]) => [key, run(decide)]));
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
      const lead = text("p", gap ? names.rl + " earned " + Math.abs(gap) + (gap > 0 ? " more" : " fewer") + " net credits than the distribution planner." : names.rl + " and the distribution planner tied on this shift.");
      lead.className = "result-lead";
      divergence.push(lead);
      const first = operators.rl.actions.findIndex((action, i) => action !== operators.stochastic.actions[i]);
      if (first >= 0) {
        const rlBooked = operators.rl.actions[first] === "accept";
        const note = text("p", "At wave " + (first + 1) + ", " + (rlBooked ? names.rl : "the distribution planner") +
          " booked the " + history[first].offer.net + "-credit offer. " + (rlBooked ? "The distribution planner" : names.rl) + " kept a slot open.");
        note.className = "result-note";
        divergence.push(note);
      }
    }
    const audit = table(["Wave","Posted high chance","True high chance","Signed credits"], "Full shift forecast audit with hidden generator probabilities");
    const auditBody = audit.createTBody();
    history.forEach((entry, i) => dataRow(auditBody, [i + 1, num(100 * entry.quote.highChance) + "%",
      num(100 * completed.trueHighChances[i]) + "%", entry.offer.net]));
    const note = text("p", patterns[config.family].label + ". " + patterns[config.family].description +
      " True odds are revealed here after replay. Agents saw posted quotes and signed offers.");
    note.className = "description";
    if (importedCase) divergence.push(text("p", "The Agent column replays " + imported.policy + "."));
    $("comparison").replaceChildren(...divergence, scrollTable(grid), text("h3", "Behind the forecast"), note, scrollTable(audit));
    if (renderPair) renderPair($("comparison"), config, weights);
  }

  async function loadEvidence() {
    async function json(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("The release file was unavailable.");
      return res.json();
    }
    try {
      const releases = await Promise.all(checkpoints.map(key => json("./data/" + key + "/results.json")));
      weights = weightsFrom ? weightsFrom(releases) : Object.fromEntries(checkpoints.map((key, i) => [key, releases[i].checkpoint.weights]));
      renderEvidence(releases[0], weights);
      if (renderSignal) renderSignal(world.observe(shift), weights);
      $("upload").hidden = false;
      if (runFeatured) {
        const historical = $("historical-run");
        historical.hidden = false;
        if (location.hash === "#historical-run") historical.scrollIntoView();
      }
      if ($("compare").open) renderComparison();
    } catch {
      $("scorecard").textContent = "The checkpoint or measurements could not be loaded. Reload the page or open the raw results below. You can still play and compare both planners.";
    }
  }

  function showReport(report, target, label) {
    const grid = table(["Demand", label, ...Object.values(names)], "Mean net credits for " + report.policy + " and the released references");
    const body = grid.createTBody();
    for (const [family,row] of Object.entries(report.summary.byFamily)) {
      dataRow(body,[patterns[family].label,num(row.mean,2),...refs.map(k=>num(row.references[k].mean,2))]);
    }
    const row = report.summary.all;
    dataRow(body,["All shifts",num(row.mean,2),...refs.map(k=>num(row.references[k].mean,2))]);
    const diff = row.references.stochastic;
    const stats = text("p", label + " versus the distribution planner averaged " + signed(diff.delta) + " credits per shift, with "
      + diff.wins + " wins, " + diff.ties + " ties and " + diff.losses + " losses.");
    const pick = text("button",target === $("report-result") ? "Inspect the first submitted shift" : "Replay the first original shift");
    pick.type = "button";
    pick.onclick = () => {
      imported = report;
      start({family: report.cases[0].family, seed: report.cases[0].seed});
      $("compare").open = true;
      renderComparison();
      $("compare").querySelector("summary").focus();
    };
    target.replaceChildren(scrollTable(grid), stats, pick);
    if (reportGroups && report.summary.byStratum) target.insertBefore(reportGroups(report.summary.byStratum, report.summary), pick);
  }

  async function runHistorical() {
    $("run-historical").disabled = true;
    $("historical-status").textContent = "Scoring every shift in your browser…";
    try {
      const report = await runFeatured(weights);
      showReport(report, $("historical-result"), report.policy);
      $("historical-status").textContent = "Scored " + num(report.cases.length) + " original shifts.";
    } catch (err) {
      $("historical-status").textContent = "Could not run this comparison. Try again. " + err.message;
    } finally { $("run-historical").disabled = false; }
  }

  async function importReport(file) {
    imported = null;
    $("report-result").replaceChildren();
    if ($("compare").open) renderComparison();
    if (!file) { $("report-status").textContent = ""; return; }
    $("report-file").disabled = true;
    $("report-status").textContent = "Replaying your decisions…";
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose a benchmark JSON report under 5 MB.");
      const report = await verifyReport(JSON.parse(await file.text()), weights);
      showReport(report, $("report-result"), "Your agent");
      imported = report;
      $("report-status").textContent = report.policy + " verified on " + report.summary.all.shifts + " " + report.split + " shifts.";
      if ($("compare").open) renderComparison();
    } catch (err) {
      $("report-status").textContent = "Could not verify this file. " + err.message;
    } finally { $("report-file").disabled = false; $("report-file").value = ""; }
  }

  function init() {
    if (!picker) for (const [split, manifest] of Object.entries(suite.splits)) {
      const group = document.createElement("optgroup");
      group.label = splitLabels[split];
      for (const family of manifest.families) group.append(new Option(patterns[family].label, family));
      $("family").append(group);
    }
    const params = new URL(location.href).searchParams;
    try {
      const settings = picker ? checkConfig(params.get("case") ?? "1", params.get("seed") ?? String(picker.initialSeed()))
        : checkConfig(params.get("family") ?? initial.family, params.get("seed") ?? String(initial.seed));
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
    if (runFeatured) $("run-historical").onclick = runHistorical;
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
}
