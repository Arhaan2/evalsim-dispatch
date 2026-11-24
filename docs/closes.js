import {
  adaptivePlanner, createCloses, observeCloses, stepCloses, stochasticPlanner,
  CLOSES_PATTERNS, CLOSES_SUITE, verifyCloses,
} from "./lib/closes.js";
import { chooseCloses, closesThreshold } from "./lib/closes-policy.js";
import { chooseTurns } from "./lib/turns-policy.js";
import { chooseDrift } from "./lib/drift-policy.js";
import { verifyClosesReport } from "./lib/closes-benchmark.js";
import { $, num, scrollTable, signed, table, text } from "./lib/freight-view.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";

const names = { rl: "History RL", ablated: "Current-only RL", stochastic: "Distribution planner",
  adaptive: "Adaptive planner", turns: "Prior Turns RL", drift: "Prior Drift RL" };
const strata = { reversal: "Reversals", "interrupted-drop": "Interrupted drops" };
const test = CLOSES_SUITE.splits.test;

// Number the fresh cases in a seed-dependent order. Visitors can share and
// replay a case without the scenario's hot/cold label appearing at the desk.
function caseOrder(seed) {
  const families = [...test.families];
  let state = seed >>> 0;
  for (let i = families.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((state / 4294967296) * (i + 1));
    [families[i], families[j]] = [families[j], families[i]];
  }
  for (const split of ["validation", "train", "retention"]) families.push(...CLOSES_SUITE.splits[split].families);
  return families;
}

const picker = {
  initialSeed() { return test.start + crypto.getRandomValues(new Uint32Array(1))[0] % test.count; },
  decode(choice, seed) { return /^[1-9]\d*$/.test(choice) ? caseOrder(seed)[Number(choice) - 1] : undefined; },
  select(select, config) {
    const order = caseOrder(config.seed);
    const current = order.indexOf(config.family) + 1;
    const options = test.families.map((_, i) => new Option("Case " + (i + 1), String(i + 1)));
    if (current > options.length) options.push(new Option("Case " + current, String(current)));
    select.replaceChildren(...options);
    select.value = String(current);
  },
  url(config, actions = [], hash = "") {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("case", String(caseOrder(config.seed).indexOf(config.family) + 1));
    url.searchParams.set("seed", String(config.seed));
    if (actions.length) url.searchParams.set("actions", actions.join(","));
    url.hash = hash;
    return url;
  },
};

const interval = pair => signed(pair.delta) + " [" + pair.interval95.map(signed).join(", ") + "]";
const note = value => Object.assign(text("p", value), { className: "result-note" });

function renderSignal(o, weights) {
  $("signal-reading").parentElement.hidden = o.done || !weights;
  if (o.done || !weights) return;
  if (!o.slots) {
    $("signal-reading").textContent = "Both truck slots are booked.";
    $("signal-decision").textContent = "";
    return;
  }
  function advice(policy, checkpoint) {
    const action = chooseCloses(o, checkpoint) === "accept" ? "books" : "passes";
    return policy + " " + action + " this offer. Booking threshold " + num(closesThreshold(o, checkpoint), 2) + " credits.";
  }
  $("signal-reading").textContent = advice(names.rl, weights.closes);
  $("signal-decision").textContent = advice(names.ablated, weights.ablated);
}

function policies(weights) {
  const planners = { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
  return weights ? { ...planners, rl: o => chooseCloses(o, weights.closes), ablated: o => chooseCloses(o, weights.ablated),
    turns: o => chooseTurns(o, weights.turns), drift: o => chooseDrift(o, weights.drift) } : planners;
}

function replayScore(config, decide) {
  const state = createCloses(config);
  while (!state.done) stepCloses(state, decide(observeCloses(state)));
  const score = verifyCloses(state);
  if (score.violations.length) throw new Error("The matched shift did not reconcile.");
  return score.net;
}

function renderPair(target, config, weights) {
  const pattern = CLOSES_PATTERNS[config.family];
  const otherEnding = pattern.ending === "hot" ? "cold" : "hot";
  const other = { family: pattern.stem + "-" + otherEnding, seed: config.seed };
  if (!Object.hasOwn(CLOSES_PATTERNS, other.family)) return;
  const here = createCloses(config).trueHighChances, there = createCloses(other).trueHighChances;
  const common = here.findIndex((chance, i) => chance !== there[i]);
  const pair = document.createElement("section");
  pair.id = "paired-endings";
  pair.append(text("h3", "One opening, two endings"),
    note("These shifts share the first " + common + " waves. This case closes " + pattern.ending
      + ". Its matched case uses the same market draws with a " + otherEnding + " finish."));
  const refs = policies(weights);
  const active = ["rl", "ablated", "stochastic"].filter(key => refs[key]);
  const grid = table(["Ending", "Final high-offer chance", ...active.map(key => names[key])], "Matched hot and cold endings, in net credits per shift");
  const body = grid.createTBody();
  for (const [settings, odds, label] of [[config, here, pattern.ending], [other, there, otherEnding]]) {
    dataRow(body, [label === "hot" ? "Hot" : "Cold", num(100 * odds.at(-1)) + "%", ...active.map(key => num(replayScore(settings, refs[key])))]);
  }
  const links = document.createElement("div");
  links.className = "section-links";
  const twin = text("a", "Play the " + otherEnding + "-ending twin →");
  twin.href = picker.url(other, [], "session");
  links.append(twin);
  pair.append(scrollTable(grid), links);
  target.prepend(pair);
}

function reportGroups(groups, summary) {
  const grid = table(["Your agent", "Shifts", "Versus history RL", "Versus current-only RL", "Versus distribution planner"],
    "Your agent’s mean paired differences in net credits with 95% intervals");
  const body = grid.createTBody();
  for (const [stratum, group] of Object.entries(groups)) {
    const row = (name, g) => dataRow(body, [name, num(g.shifts), ...["rl", "ablated", "stochastic"].map(key => interval(g.references[key]))]);
    row(strata[stratum], group);
    for (const [ending, sub] of Object.entries(summary.byStratumEnding[stratum])) row(strata[stratum] + " · " + ending, sub);
  }
  const details = document.createElement("details");
  details.append(text("summary", "Compare your agent by pattern and ending"), scrollTable(grid));
  return details;
}

function renderEvidence(release) {
  const { comparisons, guard, checks } = release;
  const { all, byStratum, byStratumEnding } = comparisons;
  const reversal = byStratum.reversal;
  const headline = text("p", "On " + num(reversal.count) + " fresh reversals, history RL averaged " + num(reversal.rl, 2)
    + " net credits per shift. The distribution planner earned " + num(reversal.stochastic, 2) + " and current-only RL earned " + num(reversal.ablated, 2) + ".");
  headline.className = "result-lead";
  const verdict = note("History RL scored " + interval(reversal.rlMinusStochastic) + " credits versus the planner. The matched fit without history scored "
    + interval(reversal.ablatedMinusStochastic) + " versus the same planner. Adding history changed earnings by "
    + interval(reversal.rlMinusAblated) + " credits per reversal. " + (checks.reversalHistory
      ? "The interval favors using history." : "The interval leaves the benefit of using history uncertain."));
  const endingsNote = note("Adding history changed reversal earnings by " + signed(byStratumEnding.reversal.cold.rlMinusAblated.delta)
    + " with a cold finish and " + signed(byStratumEnding.reversal.hot.rlMinusAblated.delta) + " with a hot finish.");
  const fresh = table(["Fresh shifts", "Shifts", "History RL credits", "Versus current-only RL", "Versus planner"],
    "History RL mean credits and paired differences with 95% intervals by pattern and closing regime");
  const freshBody = fresh.createTBody();
  const freshRow = (label, group) => dataRow(freshBody, [label, num(group.count), num(group.rl, 2),
    interval(group.rlMinusAblated), interval(group.rlMinusStochastic)]);
  for (const [stratum, endings] of Object.entries(byStratumEnding)) {
    for (const [ending, group] of Object.entries(endings)) {
      freshRow(strata[stratum] + " · " + ending, group);
    }
  }
  freshRow("All fresh shifts", all);

  const retention = table(["Interrupted drops", "Shifts", "Versus planner", "Versus Turns RL", "Versus Drift RL", "Retention"],
    "History RL minus each reference on matched interrupted drops in net credits, with 95% intervals");
  const retentionBody = retention.createTBody();
  function retentionRow(label, g, passed) {
    dataRow(retentionBody, [label, num(g.count), interval(g.rlMinusStochastic), interval(g.rlMinusTurns), interval(g.rlMinusDrift), passed ? "Passed" : "Missed"]);
  }
  retentionRow("Fresh · both endings", byStratum["interrupted-drop"], checks.freshDropRetention);
  for (const [family, g] of Object.entries(guard.byFamily)) retentionRow(CLOSES_PATTERNS[family].label, g, checks.guardRetention[family]);
  const drops = byStratumEnding["interrupted-drop"];
  const oldDrop = guard.byFamily["interrupted-drop"];
  const result = note("On fresh interrupted drops, history RL scored " + signed(byStratum["interrupted-drop"].rlMinusStochastic.delta)
    + " overall versus the planner, " + signed(drops.cold.rlMinusStochastic.delta) + " on cold endings and "
    + signed(drops.hot.rlMinusStochastic.delta) + " on hot endings. On the original interrupted drop, the change was "
    + signed(oldDrop.rlMinusTurns.delta) + " versus prior Turns RL and " + signed(oldDrop.rlMinusDrift.delta) + " versus prior Drift RL.");
  const rule = note((checks.joint ? "The full study target passed. " : "The full study target was missed. ")
    + "Retention requires a positive lower interval bound versus the planner and a lower bound above −"
    + num(release.protocol.retentionMargin) + " credit versus each previous RL agent. The three historical patterns use fresh seeds and are scored separately.");

  const detail = document.createElement("details");
  detail.append(text("summary", "All six agents and planners by test pattern"));
  const grid = table(["Fresh pattern", ...Object.values(names)], "Mean net credits for all six references on every fresh pattern");
  const body = grid.createTBody();
  for (const [family, g] of Object.entries(comparisons.byFamily)) dataRow(body, [CLOSES_PATTERNS[family].label, ...Object.keys(names).map(key => num(g[key], 2))]);
  dataRow(body, ["All fresh shifts", ...Object.keys(names).map(key => num(all[key], 2))]);
  detail.append(scrollTable(grid));
  $("scorecard").replaceChildren(headline, verdict, endingsNote, scrollTable(fresh), text("h3", "Did interrupted-drop gains hold?"), result,
    scrollTable(retention), rule, note("Brackets show paired 95% intervals. Each bootstrap draw keeps a seed’s patterns and both endings together. The estimates apply to these patterns and the released training run."),
    detail, exampleLinks(release.cases, picker.url));
}

mountDemandDesk({
  suite: CLOSES_SUITE, patterns: CLOSES_PATTERNS, picker, names, checkpoints: ["closes", "turns", "drift"],
  weightsFrom: ([current, turns, drift]) => ({ closes: current.checkpoint.weights, ablated: current.checkpoint.ablatedWeights,
    turns: turns.checkpoint.weights, drift: drift.checkpoint.weights }),
  world: { create: createCloses, observe: observeCloses, step: stepCloses, verify: verifyCloses },
  policies, renderSignal, renderPair, renderEvidence, reportGroups, verifyReport: verifyClosesReport,
});
