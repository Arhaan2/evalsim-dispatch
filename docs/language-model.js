// Display immutable experiment outputs; a visitor's browser never runs the 4B model.
const byId = (id) => document.getElementById(id);
const modes = ["base", "trained", "dispatcher"];
const modeName = { base: "Frozen Qwen", trained: "Qwen + adapter", dispatcher: "Dispatcher" };
const familyName = {
  normal: "Clear lanes", "route-closure": "Route closure", "supplier-delay": "Supplier delay",
  "capacity-cut": "Capacity cut", "demand-surge": "Demand surge", compound: "Closure + surge",
  "network-shift": "Shifted network",
};
const toolName = {
  book_shipment: "Book shipment", advance_time: "Advance time", query_inventory: "Inspect stock",
  purchase_inventory: "Buy stock", check_transport_capacity: "Check route capacity", check_supplier_status: "Check supplier",
  reserve_inventory: "Reserve stock", release_inventory: "Release reservation", track_shipment: "Track shipment",
  inspect_orders: "Inspect orders",
};
const dir = "./data/llm/";
const nf = new Intl.NumberFormat("en");
const count = (value) => nf.format(value);
const percent = (n, d) => d ? (100 * n / d).toFixed(1).replace(/\.0$/, "") + "%" : "—";
let traces = {};
let stepIndex = 0;
let loading = false;

function node(tag, value, className) {
  const el = document.createElement(tag);
  if (value !== undefined) el.textContent = value;
  if (className) el.className = className;
  return el;
}

async function readJson(file) {
  const response = await fetch(dir + file, { cache: "no-cache" });
  if (!response.ok) {
    const e = new Error("HTTP " + response.status);
    e.status = response.status;
    throw e;
  }
  return response.json();
}

function resultSummary(rows, mode) {
  return rows.reduce((out, row) => {
    const s = row[mode];
    if (!s || typeof s.success !== "boolean" || !["toolCalls", "rejectedActions", "fulfilled", "totalDemand", "spend"]
      .every((key) => Number.isSafeInteger(s[key]) && s[key] >= 0) || !s.totalDemand || s.fulfilled > s.totalDemand) {
      throw new Error("Invalid result row");
    }
    out.successes += Number(s.success);
    out.onTime += s.fulfilled;
    out.demand += s.totalDemand;
    out.toolCalls += s.toolCalls;
    out.spend += s.spend;
    out.rejections += s.rejectedActions;
    return out;
  }, { successes: 0, onTime: 0, demand: 0, spend: 0, toolCalls: 0, rejections: 0, episodes: rows.length });
}

function validateResults(data) {
  const protocol = data.protocol;
  const expected = protocol.testSeedsPerFamily * protocol.testFamilies.length;
  if (expected !== 20 || !Array.isArray(data.cases) || data.cases.length !== expected
      || new Set(data.cases.map((row) => row.seed)).size !== expected
      || !Array.isArray(data.training) || data.training.length !== 24 ||
      data.training.some((g) => !Array.isArray(g.episodes) || g.episodes.length !== 3)) {
    throw new Error("Incomplete protocol");
  }
  for (const [idx, row] of data.cases.entries()) {
    if (row.family !== protocol.testFamilies[idx % protocol.testFamilies.length] || row.seed !== protocol.testSeedStart + idx) {
      throw new Error("Test split mismatch");
    }
  }
  for (const mode of modes) {
    const computed = resultSummary(data.cases, mode);
    if (Object.keys(computed).some((k) => data.summary[mode][k] !== computed[k])) throw new Error("Summary mismatch");
  }
}

function appendDownload(file, title) {
  const a = node("a", title);
  a.href = dir + file;
  a.download = file;
  const item = node("li");
  item.append(a);
  byId("downloads").append(item);
}

function rowHeader(title) {
  const th = node("th", title);
  th.scope = "row";
  return th;
}

function showResults(data) {
  byId("run-status").hidden = true;
  byId("verified").hidden = false;
  const base = data.summary.base, trained = data.summary.trained;
  byId("finding").textContent = "The adapter completed " + trained.successes + " of " + trained.episodes
    + " shifts. Frozen Qwen completed " + base.successes + " on the same seeds.";
  byId("aggregates").replaceChildren(...modes.map((mode) => {
    const s = data.summary[mode];
    const tr = node("tr");
    if (mode === "trained") tr.className = "trained-row";
    const score = node("td", s.successes + " / " + s.episodes);
    const arrivals = node("td", percent(s.onTime, s.demand));
    arrivals.append(node("small", count(s.onTime) + " / " + count(s.demand)));
    tr.append(rowHeader(modeName[mode]), score, arrivals, node("td", count(s.toolCalls)));
    return tr;
  }));
  byId("cases").replaceChildren(...data.cases.map((r) => {
    const tr = node("tr"), head = rowHeader(familyName[r.family] ?? r.family);
    head.append(node("small", "Seed " + r.seed));
    tr.append(head, ...modes.map((m) => node("td", r[m].fulfilled + " / " + r[m].totalDemand)));
    return tr;
  }));
  const c = data.compute;
  if (c && Number.isFinite(c.trainingSeconds) && Number.isFinite(c.evaluationSeconds)) {
    byId("compute").hidden = false;
    byId("compute").textContent = "Recorded compute on " + c.processor + " (" + c.architecture + "). Training took "
      + (c.trainingSeconds / 60).toFixed(1) + " min and the paired evaluation took "
      + (c.evaluationSeconds / 60).toFixed(1) + " min. The model made " + count(c.uncachedForwards) + " uncached forward passes.";
  }
  byId("downloads").replaceChildren();
  appendDownload("results.json", "Results and training history ↓");
  appendDownload("adapter.json", "Adapter weights ↓");
}

function describeAction(a) {
  if (!a) return "Unavailable";
  const args = Object.entries(a).filter(([k]) => k !== "tool").map(([k, v]) => k + "=" + v);
  return a.tool + "(" + args.join(", ") + ")";
}

function resetTrace() {
  traces = {};
  byId("comparison").replaceChildren();
  byId("transport").hidden = true;
  byId("replay-availability").textContent = "";
}

function renderDecision() {
  const slider = byId("decision");
  const position = stepIndex + 1;
  slider.value = String(position);
  slider.setAttribute("aria-valuetext", "Decision " + position + " of " + slider.max);
  byId("position").textContent = "Decision " + position + " of " + slider.max;
  byId("previous").disabled = position === 1;
  byId("next-decision").disabled = position === Number(slider.max);
  byId("comparison").replaceChildren(...modes.map((mode) => {
    const data = traces[mode], entry = data.trace[stepIndex], article = node("article", undefined, "record");
    const header = node("header");
    header.append(node("h3", modeName[mode]), node("small", entry ? "Clock " + entry.tick : "Final state"));
    article.append(header);
    if (!entry) {
      article.append(node("h4", "Shift ended"), node("p", data.metrics.fulfilled + " / " + data.metrics.totalDemand
        + " units on time across " + data.trace.length + " calls.", "consequence"));
      return article;
    }
    article.append(node("h4", toolName[entry.action.tool] ?? entry.action.tool), node("p", entry.result, "consequence"),
      node("small", entry.ok ? "Call accepted" : "Call rejected", "outcome" + (entry.ok ? "" : " rejected")));
    const details = node("details");
    details.append(node("summary", "Inspect decision"), node("code", describeAction(entry.action)));
    const obs = entry.observation;
    if (obs) {
      const dl = node("dl");
      dl.append(node("dt", "Budget"), node("dd", count(obs.budget) + " credits"));
      for (const w of obs.warehouses ?? []) {
        dl.append(node("dt", w.name ?? w.id), node("dd", w.reportedStock + " reported free"));
      }
      details.append(dl);
    }
    if (Array.isArray(entry.choices) && entry.choices.length) {
      const list = node("ul");
      for (const choice of entry.choices) {
        const item = node("li", choice.label + " · " + percent(choice.probability, 1) + " · ");
        item.append(node("code", describeAction(choice.action)));
        list.append(item);
      }
      details.append(node("small", "Model probabilities"), list);
    }
    if (entry.events?.length) {
      const list = node("ul");
      for (const e of entry.events) list.append(node("li", "Clock " + e.tick + " · " + e.message));
      details.append(node("small", "Simulator events"), list);
    }
    article.append(details);
    return article;
  }));
}

async function loadTraces(data) {
  resetTrace();
  byId("recording").hidden = false;
  const expected = data.cases.find((row) => row.family === "compound");
  byId("trace-intro").textContent = "Retrieving the three recorded operator traces…";
  const values = await Promise.all(modes.map((m) => readJson("trace-" + m + ".json")));
  for (const [i, value] of values.entries()) {
    const mode = modes[i];
    if (!expected || !value || value.mode !== mode || value.seed !== expected.seed || value.family !== expected.family
        || !Array.isArray(value.trace) || value.trace.length !== expected[mode].toolCalls
        || value.trace.some((e) => !e.action?.tool || !Number.isInteger(e.tick) || typeof e.ok !== "boolean")
        || Object.entries(expected[mode]).some(([k, n]) => value.metrics?.[k] !== n)) {
      throw new Error("Replay mismatch");
    }
    traces[mode] = value;
  }
  byId("trace-intro").textContent = familyName[expected.family] + ", seed " + expected.seed
    + ". Both model checkpoints and the dispatcher faced this recorded shift. Decisions align by call number. Each operator’s clock shows when it acted.";
  for (const mode of modes) appendDownload("trace-" + mode + ".json", modeName[mode] + " trace ↓");
  byId("transport").hidden = false;
  byId("decision").max = String(Math.max(...values.map((v) => v.trace.length)));
  stepIndex = 0;
  renderDecision();
}

async function load() {
  if (loading) return;
  loading = true;
  byId("retry").hidden = true;
  try {
    const data = await readJson("results.json");
    validateResults(data);
    showResults(data);
    try {
      await loadTraces(data);
    } catch {
      resetTrace();
      byId("trace-intro").textContent = "The published summary is available. The matching recording could not be loaded.";
      byId("retry").hidden = false;
    }
  } catch (e) {
    byId("verified").hidden = true;
    byId("recording").hidden = true;
    byId("run-status").hidden = false;
    byId("run-status").textContent = e.status === 404
      ? "The protocol is available. Verified results and recorded decisions will appear here when the experiment is published."
      : "Published results could not be verified. Check again or open the training implementation below.";
    byId("retry").hidden = false;
  } finally { loading = false; }
}

byId("decision").addEventListener("input", (event) => { stepIndex = Number(event.target.value) - 1; renderDecision(); });
byId("previous").addEventListener("click", () => { if (stepIndex > 0) { stepIndex--; renderDecision(); } });
byId("next-decision").addEventListener("click", () => {
  if (stepIndex + 1 < Number(byId("decision").max)) { stepIndex++; renderDecision(); }
});
byId("retry").addEventListener("click", load);
load();
