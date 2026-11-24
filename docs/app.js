import {
  SCENARIOS,
  makeScenario,
  createWorld,
  observe,
  step,
  verify,
  snapshot,
} from "./lib/world.js";
import { chooseAction } from "./lib/policy.js";
import { drawChallenge } from "./lib/challenger.js";
import { createAtlas, locations } from "./lib/atlas.js";

const $ = (id) => document.getElementById(id);
const names = {
  trained: "Adaptive RL",
  uniform: "Uniform RL",
  untrained: "Before training",
  dispatcher: "Dispatcher",
  "challenger-trained": "Challenger-trained RL",
  "challenger-uniform": "Matched uniform RL",
};
const pct = (fraction) =>
  (fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
const decimal = (value) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const textElement = (tag, value, className) => {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
};

let checkpoints,
  challenger,
  challengerReport,
  report,
  runs = [],
  frameIndex = 0,
  timer = null,
  selected = null,
  selectedMap = 0;
let config,
  split = false;
const atlases = [
  createAtlas($("atlas-primary"), "primary"),
  createAtlas($("atlas-comparison"), "comparison"),
];

function policyObject(key) {
  if (key === "dispatcher") return "dispatcher";
  if (key === "challenger-trained" || key === "challenger-uniform") {
    const mode = key === "challenger-trained" ? "learned" : "uniform";
    return challengerReport.trials.find(
      (trial) =>
        trial.mode === mode && trial.replicate === challengerReport.seed,
    ).checkpoint;
  }
  if (key.startsWith("history-"))
    return checkpoints.history.find((h) => h.episodes === Number(key.slice(8)))
      .trained;
  return checkpoints[key];
}

function execute(config, policy) {
  const world = createWorld(makeScenario(config.seed, config.kind));
  const frames = [
    {
      state: snapshot(world),
      score: verify(world),
      observation: observe(world),
      action: null,
      result: null,
    },
  ];
  while (!world.done) {
    const observation = observe(world);
    const action = chooseAction(observation, policyObject(policy));
    const result = step(world, action);
    frames.push({
      state: snapshot(world),
      score: verify(world),
      observation,
      action,
      result,
    });
  }
  const paired = policy.startsWith("challenger-");
  return {
    frames,
    policy,
    name: names[policy],
    experiment: paired ? challengerReport.signature : report.signature,
    trainingSeed: ["dispatcher", "untrained"].includes(policy)
      ? null
      : paired
        ? challengerReport.seed
        : report.demoTrainingSeed,
  };
}

function maxIndex() {
  return Math.max(...runs.map((r) => r.frames.length - 1));
}
function frameAt(run, index = frameIndex) {
  return run.frames[Math.min(index, run.frames.length - 1)];
}
function refreshSettingsNote() {
  if (!config) return;
  const changed =
    (config.challenge ? "challenger" : config.kind) !== $("scenario").value ||
    String(config.challenge?.viewerSeed ?? config.seed) !== $("seed").value ||
    config.operator !== $("policy").value ||
    config.rival !== $("rival").value;
  $("settings-note").textContent = changed
    ? "Run the episode to apply these settings."
    : "";
}
function syncFields() {
  const mode = $("scenario").value;
  $("scenario-detail").textContent =
    mode === "challenger"
      ? "A trained challenger chooses a feasible disruption and an opening demand band from this seed."
      : (SCENARIOS.find((s) => s.id === mode)?.description ?? "");
  refreshSettingsNote();
}
function writeUrl() {
  const url = new URL(location.href);
  url.searchParams.set("seed", config.challenge?.viewerSeed ?? config.seed);
  url.searchParams.set(
    "scenario",
    config.challenge ? "challenger" : config.kind,
  );
  url.searchParams.set("operator", config.operator);
  url.searchParams.set("compare", config.rival);
  history.replaceState(null, "", url);
}
function build(autoplay = false, updateUrl = false) {
  if (!$("seed").reportValidity()) return;
  const nextConfig = {
    seed: Number($("seed").value),
    kind: $("scenario").value,
    operator: $("policy").value,
    rival: $("rival").value,
  };
  if (
    !Number.isInteger(nextConfig.seed) ||
    nextConfig.seed < 0 ||
    nextConfig.seed > 4294967295
  )
    return;
  if (nextConfig.kind === "challenger") {
    const viewerSeed = nextConfig.seed,
      chosen = drawChallenge(challenger, viewerSeed);
    nextConfig.challenge = { viewerSeed, ...chosen };
    nextConfig.kind = chosen.kind;
    nextConfig.seed = chosen.seed;
  }
  stop();
  config = nextConfig;
  runs = [execute(config, config.operator), execute(config, config.rival)];
  frameIndex = 0;
  selected = null;
  $("scrub").max = maxIndex();
  for (const id of ["run", "play", "next", "scrub", "compare"])
    $(id).disabled = false;
  $("export-traces").disabled = false;
  $("episode-label").textContent =
    (config.challenge?.label ??
      SCENARIOS.find((s) => s.id === config.kind).label) +
    " · Seed " +
    config.seed;
  const inspection = $("inspection");
  inspection.replaceChildren(
    ...runs.map(
      (r, i) =>
        new Option(
          r.name +
            (runs[0].policy === runs[1].policy
              ? " · " + (i ? "comparison" : "operator")
              : ""),
          i,
        ),
    ),
  );
  $("first-map").querySelector(".map-caption").textContent = runs[0].name;
  $("second-map").querySelector(".map-caption").textContent = runs[1].name;
  $("settings-note").textContent = "";
  if (updateUrl) writeUrl();
  render();
  if (autoplay) start();
}

function stop() {
  clearInterval(timer);
  timer = null;
  $("play").querySelector("use").setAttribute("href", "#i-play");
  const label =
    runs.length && frameIndex >= maxIndex() ? "Replay episode" : "Play episode";
  $("play").setAttribute("aria-label", label);
  $("play").title = label;
}
function start() {
  if (!runs.length) return;
  if (frameIndex >= maxIndex()) {
    frameIndex = 0;
    render();
  }
  clearInterval(timer);
  timer = setInterval(
    () => {
      frameIndex++;
      render(true);
      if (frameIndex >= maxIndex()) stop();
    },
    850 / Number($("speed").value),
  );
  $("play").querySelector("use").setAttribute("href", "#i-pause");
  $("play").setAttribute("aria-label", "Pause episode");
  $("play").title = "Pause episode";
}

function renderScores() {
  $("scores").replaceChildren(
    ...runs.map((r, i) => {
      const { score, state } = frameAt(r);
      const tr = document.createElement("tr");
      const who = textElement("th", r.name);
      who.scope = "row";
      who.prepend(textElement("i", "", "policy-mark" + (i ? " alt" : "")));
      if (score.done)
        who.append(
          textElement(
            "small",
            score.success ? "All orders on time" : "Incomplete fulfillment",
            "finished",
          ),
        );
      [
        who,
        textElement("td", score.fulfilled + " / " + score.totalDemand),
        textElement("td", score.spend + " / " + state.initialBudget),
        textElement("td", score.toolCalls),
        textElement("td", state.tick + " / " + state.horizon),
      ].forEach((cell) => tr.append(cell));
      return tr;
    }),
  );
  const records = runs.map((r) => frameAt(r).score);
  const failures = records.reduce((n, s) => n + s.violations.length, 0);
  $("audit").textContent =
    (failures
      ? failures + " ledger inconsistencies. "
      : "Both ledgers reconcile. ") +
    "Spend uses freight credits. Operators share a scenario and advance one decision at a time." +
    (config.challenge
      ? " The challenger assigned this condition a " +
        pct(config.challenge.probability) +
        " chance."
      : "");
}

function describeNode(index, id) {
  const { state } = frameAt(runs[index]),
    node = locations[id];
  if (node.kind === "Warehouse") {
    const w = state.warehouses.find((w) => w.id === id);
    return (
      w.stock +
      " units in stock · " +
      w.available +
      " available · Operator report " +
      w.reportedStock
    );
  }
  if (node.kind === "Supplier") {
    const s = state.suppliers.find((s) => s.id === id);
    return (
      s.available +
      " units available · Supplies " +
      locations[s.warehouse].name +
      " · Quoted lead time " +
      s.eta +
      " ticks"
    );
  }
  const o = state.orders.find((o) => o.customer === id);
  return (
    o.onTime +
    " of " +
    o.demand +
    " units on time · " +
    o.inTransit +
    " in transit · Due tick " +
    o.deadline
  );
}
function showNode() {
  const detail = $("node-detail");
  detail.hidden = !selected;
  if (!selected) return;
  const close = textElement("button", "Close");
  close.type = "button";
  close.onclick = () => {
    const node = selected;
    selected = null;
    render();
    $(selectedMap ? "atlas-comparison" : "atlas-primary")
      .querySelector('[data-node="' + node + '"]')
      ?.focus();
  };
  detail.replaceChildren(
    textElement("strong", locations[selected].name),
    textElement(
      "span",
      (split ? runs[selectedMap].name + " · " : "") +
        describeNode(selectedMap, selected),
    ),
    close,
  );
}
function formatTrace(events) {
  return events.map((e) => e.message).join(" ");
}
function traceRow(at, headline, detail) {
  const li = document.createElement("li");
  const info = document.createElement("div");
  info.append(textElement("span", headline, "trace-key"));
  if (detail) info.append(textElement("small", detail));
  li.append(textElement("span", "D" + at, "tick"), info);
  return li;
}
function renderInspector() {
  const idx = Number($("inspection").value),
    run = runs[idx],
    frame = frameAt(run);
  $("orders").replaceChildren(
    ...frame.state.orders.map((o) => {
      const row = textElement("div", "", "order");
      const label = document.createElement("div");
      label.append(
        textElement("span", locations[o.customer].name),
        textElement("small", "Due tick " + o.deadline),
      );
      const value = textElement("div", "", "qty");
      value.append(
        textElement("span", o.onTime + " / " + o.demand + " on time"),
        textElement("small", o.inTransit + " in transit"),
      );
      row.append(label, value);
      return row;
    }),
  );
  const used = Math.min(frameIndex, run.frames.length - 1);
  const recent = run.frames.slice(Math.max(1, used - 3), used + 1).reverse();
  if (recent.length) {
    $("trace").replaceChildren(
      ...recent.map((f) =>
        traceRow(
          f.state.decisions,
          f.action.tool,
          f.result.message + " " + formatTrace(f.result.events),
        ),
      ),
    );
  } else {
    $("trace").replaceChildren(
      traceRow(0, "Shift opened", formatTrace(frame.state.events)),
    );
  }
  if ($("observation").parentElement.open) {
    $("observation").textContent = JSON.stringify(
      {
        observation: frame.observation,
        action: frame.action,
        result: frame.result,
      },
      null,
      2,
    );
  }
}

function render(animated = false) {
  if (!runs.length) return;
  const duration = animated ? Math.min(510, 740 / Number($("speed").value)) : 0;
  atlases.forEach((paint, index) => {
    if (index === 0 || split)
      paint(
        frameAt(runs[index]).state,
        selectedMap === index ? selected : null,
        duration,
      );
  });
  $("scrub").value = frameIndex;
  $("step-count").textContent = frameIndex + " / " + maxIndex();
  $("next").disabled = frameIndex >= maxIndex();
  $("scrub").setAttribute(
    "aria-valuetext",
    "Decision " + frameIndex + " of " + maxIndex(),
  );
  if (timer === null) stop();
  showNode();
  renderScores();
  renderInspector();
}

function toggleCompare() {
  split = !split;
  $("compare").setAttribute("aria-pressed", String(split));
  $("second-map").hidden = !split;
  document.querySelector(".maps").classList.toggle("split", split);
  if (!split && selectedMap === 1) {
    selected = null;
    selectedMap = 0;
  }
  render();
}

function addChart(series) {
  if (!series.length) return;
  const W = 500,
    H = 148,
    L = 40,
    R = 12,
    T = 10,
    B = 28;
  const total = Math.max(...series.map((d) => d.episodes), 1);
  const x = (n) => L + (n / total) * (W - L - R),
    y = (n) => T + (1 - n) * (H - T - B);
  const lines = [0, 0.5, 1]
    .map(
      (n) =>
        '<path d="M' +
        L +
        " " +
        y(n) +
        "H" +
        (W - R) +
        '" stroke="#dce2da"/><text x="' +
        (L - 7) +
        '" y="' +
        (y(n) + 3) +
        '" text-anchor="end">' +
        n * 100 +
        "%</text>",
    )
    .join("");
  const xticks = [0, Math.round(total / 2), total]
    .map(
      (n, i) =>
        '<text x="' +
        x(n) +
        '" y="' +
        (H - 8) +
        '" text-anchor="' +
        (i === 2 ? "end" : i === 0 ? "start" : "middle") +
        '">' +
        n.toLocaleString("en-US") +
        "</text>",
    )
    .join("");
  const metric = $("chart-metric").value;
  const paths = ["uniform", "adaptive"]
    .map((key, i) => {
      const pts = series
        .map(
          (d) => x(d.episodes).toFixed(2) + "," + y(d[key + metric]).toFixed(2),
        )
        .join(" ");
      return (
        '<polyline points="' +
        pts +
        '" fill="none" stroke="' +
        (i ? "#216ea5" : "#69736b") +
        '" stroke-width="' +
        (i ? "2.3" : "2") +
        '" ' +
        (i ? "" : 'stroke-dasharray="5 3"') +
        "/>"
      );
    })
    .join("");
  const title = metric
    ? "Validation full-episode success by training episode"
    : "Validation on-time fulfillment by training episode";
  $("learning-chart").innerHTML =
    '<svg class="curve" viewBox="0 0 ' +
    W +
    " " +
    H +
    '" role="img" aria-label="' +
    title +
    '"><title>' +
    title +
    "</title>" +
    lines +
    paths +
    xticks +
    "</svg>";
  const metricLabel = metric
    ? "all-orders success"
    : "on-time unit fulfillment";
  $("curve-description").textContent =
    "Training episodes on the horizontal axis. Each point averages " +
    metricLabel +
    " on " +
    report.validationCases +
    " validation scenarios across " +
    report.trainingSeeds.length +
    " training seeds.";
}

function renderHeldOut() {
  const subset = $("test-scope").value === "unseen";
  $("evidence-scores").replaceChildren(
    ...report.summary.map((r) => {
      const tr = document.createElement("tr");
      const name = textElement("th", r.label);
      name.scope = "row";
      const row = subset ? r.unseenFamilies : r;
      tr.append(
        name,
        textElement("td", pct(row.fulfillment)),
        textElement("td", pct(row.success)),
        textElement("td", decimal(row.cost)),
        textElement("td", decimal(row.toolCalls)),
      );
      return tr;
    }),
  );
  // The fixed test suite allocates the same number of seeds to every family.
  const unseen =
    (report.testCases * report.heldOutFamilies.length) /
    (report.heldOutFamilies.length + report.trainFamilies.length);
  const byId = Object.fromEntries(report.summary.map((r) => [r.id, r]));
  $("test-finding").textContent =
    "Across " +
    report.testCases +
    " test scenarios, uniform RL completed " +
    pct(byId.uniform.success) +
    " of episodes. On the " +
    unseen +
    " cases combining unfamiliar disruptions or network changes, the dispatcher led at " +
    pct(byId.dispatcher.unseenFamilies.success) +
    ", followed by uniform RL at " +
    pct(byId.uniform.unseenFamilies.success) +
    " and adaptive RL at " +
    pct(byId.adaptive.unseenFamilies.success) +
    ".";
}

function renderEvidence() {
  addChart(report.curves);
  renderHeldOut();
  const thresholds = ["adaptive", "uniform"].map(
    (mode) =>
      report.curves.find((point) => point[mode + "Success"] >= report.threshold)
        ?.episodes,
  );
  const shared = thresholds[0] !== undefined && thresholds[0] === thresholds[1];
  $("research-intro").textContent = shared
    ? "Both curricula first crossed the " +
      pct(report.threshold) +
      " average validation success target at the " +
      thresholds[0].toLocaleString("en-US") +
      "-episode checkpoint. This experiment shows no consistent acceleration from adaptive sampling."
    : "Compare policies on the fixed validation suite and held-out freight scenarios.";
  $("method").textContent =
    typeof report.method === "string"
      ? report.method
      : "The operator learns a policy over typed dispatch actions from simulator rewards. The two curricula use the same training budget.";
  $("research-details").textContent =
    "Full success requires every commitment to arrive on time and the verifier to reconcile the ledger. Spend is measured in freight credits.";
  const second = Object.fromEntries(
    challengerReport.summary.map((row) => [row.mode, row.overall.success]),
  );
  $("challenger-finding").textContent =
    "In a separate experiment with " +
    challengerReport.budget.toLocaleString("en-US") +
    " operator calls per run, the learned challenger’s operator completed " +
    pct(second.learned) +
    " of test episodes. Uniform sampling reached " +
    pct(second.uniform) +
    ". Choose “Challenger chooses” to sample its learned distribution.";
}

function respondToNavigation() {
  const nav = document.querySelectorAll(".primary-nav a");
  const evidence =
    $("evidence").getBoundingClientRect().top < innerHeight * 0.5;
  nav.forEach((a, i) => {
    const active = Boolean(i) === evidence;
    a.classList.toggle("current", active);
    if (active) a.setAttribute("aria-current", "location");
    else a.removeAttribute("aria-current");
  });
}
$("run").addEventListener("click", () => build(true, true));
$("play").addEventListener("click", () => (timer ? stop() : start()));
$("next").addEventListener("click", () => {
  stop();
  frameIndex = Math.min(maxIndex(), frameIndex + 1);
  render(true);
});
$("scrub").addEventListener("input", () => {
  stop();
  frameIndex = Number($("scrub").value);
  render();
});
$("speed").addEventListener("change", () => {
  if (timer) start();
});
$("compare").addEventListener("click", toggleCompare);
$("inspection").addEventListener("change", () => {
  if (runs.length) renderInspector();
});
$("export-traces").addEventListener("click", () => {
  if (!runs.length) return;
  const artifact = {
    experiment: report.signature,
    scenario: config,
    challengerExperiment: config.challenge ? challengerReport.signature : null,
    runs,
  };
  const blob = new Blob([JSON.stringify(artifact, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.download = "dispatch-" + config.kind + "-" + config.seed + ".json";
  anchor.href = url;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("test-scope").addEventListener("change", () => {
  if (report) renderHeldOut();
});
$("chart-metric").addEventListener("change", () => {
  if (report) addChart(report.curves);
});
$("observation").parentElement.addEventListener("toggle", () => {
  if (runs.length) renderInspector();
});
for (const id of ["scenario", "seed", "policy", "rival"])
  $(id).addEventListener("input", syncFields);
$("shuffle").addEventListener("click", () => {
  $("seed").value = crypto.getRandomValues(new Uint32Array(1))[0];
  syncFields();
});
$("zoom").addEventListener("click", () => {
  const active = document.querySelector(".maps").classList.toggle("zoomed");
  $("zoom").setAttribute("aria-pressed", String(active));
  $("zoom").textContent = active ? "Fit map" : "Enlarge map";
  document
    .querySelectorAll(".map-window")
    .forEach(
      (w) => (w.scrollLeft = active ? (w.scrollWidth - w.clientWidth) / 2 : 0),
    );
});
$("options").addEventListener("click", () => {
  const expanded = document
    .querySelector(".setup")
    .classList.toggle("expanded");
  $("options").setAttribute("aria-expanded", String(expanded));
  $("options").textContent = expanded ? "Hide options" : "Episode options";
});
for (const [index, el] of [
  $("atlas-primary"),
  $("atlas-comparison"),
].entries()) {
  const inspect = (e) => {
    const station = e.target.closest("[data-node]");
    if (!station || !runs.length) return;
    selected = station.dataset.node;
    selectedMap = index;
    showNode();
    render();
  };
  el.addEventListener("click", inspect);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inspect(e);
    }
  });
}
addEventListener("scroll", respondToNavigation, { passive: true });
document.querySelectorAll('a[href="#simulator"]').forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    if (location.hash === "#evidence") {
      const url = new URL(location.href);
      url.hash = "simulator";
      history.replaceState(null, "", url);
    }
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }),
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw Error("Could not load " + path);
  return res.json();
}

async function initialize() {
  $("scenario").replaceChildren(
    ...SCENARIOS.map((s) => new Option(s.label, s.id)),
    new Option("Challenger chooses", "challenger"),
  );
  const query = new URLSearchParams(location.search);
  $("scenario").value =
    query.get("scenario") === "challenger" ||
    SCENARIOS.some((s) => s.id === query.get("scenario"))
      ? query.get("scenario")
      : "route-closure";
  const seed = query.get("seed");
  if (seed !== null && /^\d{1,10}$/.test(seed) && Number(seed) <= 4294967295)
    $("seed").value = Number(seed);
  [checkpoints, report, challenger, challengerReport] = await Promise.all([
    getJSON("./data/checkpoints.json"),
    getJSON("./data/experiment.json"),
    getJSON("./data/challenger/checkpoint.json"),
    getJSON("./data/challenger/experiment.json"),
  ]);
  if (checkpoints.history?.length) {
    const group = document.createElement("optgroup");
    group.label = "Training history";
    for (const h of checkpoints.history.filter(
      (h) =>
        h.episodes > 0 &&
        h.episodes < Math.max(...checkpoints.history.map((p) => p.episodes)),
    )) {
      const id = "history-" + h.episodes;
      names[id] =
        "Adaptive RL · " + h.episodes.toLocaleString("en-US") + " episodes";
      group.append(new Option(names[id], id));
    }
    $("policy").append(group);
    $("rival").append(group.cloneNode(true));
  }
  const challengeGroup = document.createElement("optgroup");
  challengeGroup.label = "Equal-budget challenger experiment";
  for (const key of ["challenger-trained", "challenger-uniform"])
    challengeGroup.append(new Option(names[key], key));
  $("policy").append(challengeGroup);
  $("rival").append(challengeGroup.cloneNode(true));
  if (Object.hasOwn(names, query.get("operator")))
    $("policy").value = query.get("operator");
  if (Object.hasOwn(names, query.get("compare")))
    $("rival").value = query.get("compare");
  $("scenario").disabled = false;
  syncFields();
  build();
  renderEvidence();
  $("load-message").hidden = true;
  respondToNavigation();
}
initialize().catch((error) => {
  $("load-message").textContent =
    "The simulator could not load its experiment files. Reload the page to try again.";
  console.error(error);
});
