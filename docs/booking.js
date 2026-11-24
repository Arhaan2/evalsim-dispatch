import { adaptivePlanner, createBooking, observeBooking, stepBooking, stochasticPlanner,
  BOOKING_PATTERNS, BOOKING_SUITE, verifyBooking } from "./lib/booking.js";
import { bookingDecision } from "./lib/booking-policy.js";
import { bookingReferences, bookingWeights } from "./lib/booking-benchmark.js";
import { $, num, scrollTable, signed, table, text } from "./lib/freight-view.js";
import { dataRow, exampleLinks, mountDemandDesk } from "./lib/demand-desk.js";
import { interval, note, pairedDesk, verifyInWorker } from "./lib/paired-desk.js";

const names = { rl: "Booking agent", stochastic: "Distribution planner", survey: "Survey agent", rally: "Rally agent",
  equal: "Equal-weight Booking", earlyPlanner: "Planner → Survey", earlyRally: "Rally → Survey", trust: "Trust router",
  turns: "Turns RL", drift: "Drift RL", closes: "Closes RL", always: "Follow survey", never: "Ignore survey",
  ablated: "Current-only Rally", adaptive: "Adaptive planner" };
const world = { create: createBooking, observe: observeBooking, step: stepBooking, verify: verifyBooking };
const policies = weights => weights ? bookingReferences(weights) : { stochastic: stochasticPlanner, adaptive: adaptivePlanner };
const paired = pairedDesk({ suite: BOOKING_SUITE, patterns: BOOKING_PATTERNS, world, policies, names,
  compareKeys: ["rl", "stochastic", "survey"], extraSplits: ["validation", "train", "retention", "archive"] });
const call = action => action === "accept" ? "Book" : "Pass";

function renderSignal(o, weights) {
  const reading = $("signal-reading");
  reading.parentElement.hidden = o.done || !weights;
  if (o.done || !weights) return;
  const d = bookingDecision(o, weights.booking, weights);
  const early = o.wave < 6;
  $("phase").textContent = early ? "Before the final survey" : "Final survey received";
  $("booking-values").hidden = !early || !o.slots;
  if (!o.slots) {
    reading.textContent = "Both slots are booked.";
    $("signal-decision").textContent = "";
    return;
  }
  const refs = policies(weights);
  if (early) {
    reading.textContent = "Estimated remaining credits, including this decision";
    $("book-value").textContent = num(d.bookValue, 2);
    $("wait-value").textContent = num(d.waitValue, 2);
    const advantage = d.advantage === 0 ? "Both actions have equal estimated value." :
      (d.advantage > 0 ? "Booking" : "Waiting") + " leads by " + num(Math.abs(d.advantage), 2) + " credits.";
    $("signal-decision").textContent = "The Booking agent would " + call(d.action).toLowerCase() + ". " + advantage
      + " The planner would " + call(refs.stochastic(o)).toLowerCase() + " and Survey would " + call(refs.survey(o)).toLowerCase() + ".";
  } else {
    reading.textContent = "The frozen Survey policy chooses for the last two waves using the slots you have left.";
    $("signal-decision").textContent = "Survey would " + call(d.action).toLowerCase() + ". The planner would " + call(refs.stochastic(o)).toLowerCase() + ".";
  }
}

function disclosure(title, ...contents) {
  const result = document.createElement("details");
  result.append(text("summary", title), ...contents);
  return result;
}

// Both alternatives face exactly the same remaining offers and use the
// frozen released policy after the selected action. Only revealed replays
// call this function. The live agent receives only its public observation.
function hindsight(config, prefix, first, decide) {
  const state = createBooking(config);
  for (const action of [...prefix, first]) stepBooking(state, action);
  while (!state.done) stepBooking(state, decide(observeBooking(state)));
  return verifyBooking(state).net;
}

function renderReplay(target, config, weights) {
  paired.renderPair(target, config, weights);
  if (!weights) return;
  const state = createBooking(config), refs = policies(weights), prefix = [];
  const grid = table(["Wave", "Offer", "Slots", "Booking agent", "Planner", "Survey agent", "Estimated book − wait", "Realized book − wait"],
    "Early decisions with the Booking agent’s remaining slots, estimated and realized booking advantages in net credits");
  const body = grid.createTBody();
  while (state.wave < 6) {
    const o = observeBooking(state), d = bookingDecision(o, weights.booking, weights);
    const actual = o.slots ? hindsight(config, prefix, "accept", refs.rl) - hindsight(config, prefix, "pass", refs.rl) : null;
    dataRow(body, [o.wave + 1, o.offer.net, o.slots, o.slots ? call(d.action) : "Full",
      o.slots ? call(refs.stochastic(o)) : "—", o.slots ? call(refs.survey(o)) : "—",
      o.slots ? signed(d.advantage) : "—", actual === null ? "—" : signed(actual)]);
    stepBooking(state, d.action);
    prefix.push(d.action);
  }
  const details = disclosure("Inspect this shift’s early decisions",
    note("Positive values favor booking. The model estimated the first difference from the offers and quotes available at that wave. The realized difference replays both actions on the same future offers and uses the Booking agent for every later decision."),
    scrollTable(grid));
  details.id = "decision-trace";
  (target.querySelector("#paired-endings") ?? target).append(details);
}

function earlyEvidence(audit) {
  const section = document.createElement("section");
  section.id = "early-decisions";
  section.append(text("h3", "What did the early decisions earn?"),
    note("The Booking and Survey agents use the same policy from wave seven. On each earlier wave, we replay the Survey agent’s decision and the Booking agent’s alternative on identical remaining offers. Both then follow Booking. Adding the six wave contributions gives their actual score difference."));
  const grid = table(["Market", "Shifts", "Decisions changed", "Earlier bookings", "Waits", "Credits from bookings / shift", "Credits from waits / shift", "Total / shift"],
    "Credit differences from early bookings and waits, averaged across every shift in each market");
  const body = grid.createTBody();
  const targets = [
    ["Fresh hot drops", audit.test.survey["interrupted-drop/hot"]],
    ["Fresh cold reversals", audit.test.survey["reversal/cold"]],
    ["Earlier cold reversals", audit.archive.survey["reversal/cold"]],
    ["Original interrupted drop", audit.retention.survey.all],
  ];
  for (const [label,r] of targets) {
    const total = key => r.byWave.reduce((sum,w) => sum + w[key], 0);
    dataRow(body, [label,num(r.shifts),num(total("differing")),num(total("bookings")),num(total("waits")),
      signed(total("bookingCredits")/r.shifts),signed(total("waitCredits")/r.shifts),signed(r.net/r.shifts)]);
  }
  section.append(scrollTable(grid));
  const waves = table(["Wave", ...targets.map(([label]) => label)], "Booking minus Survey credits per shift attributable to each early wave");
  const rows = waves.createTBody();
  for (let w = 0; w < 6; w++) dataRow(rows,[w + 1, ...targets.map(([,r]) => signed(r.byWave[w].net/r.shifts))]);
  section.append(disclosure("See the contribution at each wave",scrollTable(waves)));
  return section;
}

function matchedExample(weights) {
  const section = document.createElement("section");
  section.id = "early-examples";
  const grid = table(["Second offer", "Book now", "Wait", "Booking agent", "Planner"],
    "Estimated remaining credits and wave-four decisions on two validation shifts");
  const rows = grid.createTBody(), links = document.createElement("div");
  links.className = "section-links";
  for (const seed of [14200008, 14200029]) {
    const config = { family: "late-shelf-cold", seed };
    const state = createBooking(config);
    while (state.wave < 3) {
      const o = observeBooking(state);
      stepBooking(state, bookingDecision(o, weights.booking, weights).action);
    }
    const o = observeBooking(state), d = bookingDecision(o, weights.booking, weights);
    dataRow(rows, [o.history[1].offer.net + " credits", num(d.bookValue,2), num(d.waitValue,2),
      call(d.action), call(stochasticPlanner(o))]);
    const link = text("a", "Play the " + o.history[1].offer.net + "-credit history →");
    link.href = paired.picker.url(config, state.calls.map(c => c.id), "session");
    links.append(link);
  }
  section.append(text("h3", "Would you take 24 credits?"),
    note("At wave four, these two validation shifts have the same forecast, the same 24-credit offer and one slot left. Only the second signed price differs. The planner books both. The Booking agent waits on the shift that previously offered 18 credits."),
    scrollTable(grid),links);
  return section;
}

function identicalOffers(release, weights) {
  const details = disclosure("Replay one decision with two different outcomes",
    note("On wave six both agents saw the same signed prices, the same 80% bulletin, a 24-credit offer and one slot. Booking estimated 24 credits for taking the offer and 22.11 for waiting. It booked on both shifts. Survey and the planner both passed."));
  details.id = "identical-offers";
  const grid = table(["Shift", "Booking agent", "Planner", "Survey agent"], "Final net credits on two different shifts with identical public observations at wave six");
  const rows = grid.createTBody(), links = document.createElement("div");
  links.className = "section-links";
  for (const [label, family, seed, cases] of [["Fresh hot drop", "shallow-slide-hot", 14300260, release.cases],
    ["Original drop", "interrupted-drop", 14400026, release.guard.cases]]) {
    const row = cases.find(r => r.family === family && r.seed === seed);
    dataRow(rows, [label, row.rl, row.stochastic, row.survey]);
    const state = createBooking(row);
    while (state.wave < 5) {
      const o = observeBooking(state);
      stepBooking(state, bookingDecision(o, weights.booking, weights).action);
    }
    const link = text("a", "Play the " + label.toLowerCase() + " →");
    link.href = paired.picker.url(row, state.calls.map(c => c.id), "session");
    links.append(link);
  }
  details.append(scrollTable(grid), links);
  return details;
}

function targetEvidence(release) {
  const { comparisons, guard, archive, checks } = release;
  const fresh = comparisons.byStratumEnding, earlier = archive.comparisons.byStratumEnding;
  const rows = [
    ["Fresh hot-ending drops", fresh["interrupted-drop"].hot, checks.hotDrops],
    ["Fresh cold-ending reversals", fresh.reversal.cold, checks.coldReversals],
    ["Earlier cold-ending reversals", earlier.reversal.cold, checks.archiveColdReversals],
    ["Original interrupted drop", guard.comparisons.all, checks.originalDrop],
  ];
  const count = [checks.hotDrops, checks.coldReversals && checks.archiveColdReversals, checks.originalDrop].filter(Boolean).length;
  const lead = text("p", "The Booking agent met " + count + " of the three targets.");
  lead.className = "result-lead";
  const interpretation = note("It beat the planner on fresh cold reversals. On the earlier cold-reversal patterns the interval includes zero. On the original drop it earned more than Survey and the planner, but fell outside the one-credit margin against all four earlier agents. The planner earned more on fresh hot drops.");
  const grid = table(["Market", "Shifts", "Versus planner", "Versus Survey", "Check"],
    "Booking minus each reference in mean net credits per shift with paired 95% intervals");
  grid.className = "test-results";
  const body = grid.createTBody();
  for (const [label, r, pass] of rows)
    dataRow(body, [label, num(r.count), interval(r.rlMinusStochastic), interval(r.rlMinusSurvey), pass ? "Passed" : "Missed"]);
  const original = guard.comparisons.all;
  const retention = table(["Reference", "Original drop difference", "Within 1 credit"], "Original interrupted-drop historical retention comparisons");
  const historical = retention.createTBody();
  for (const name of ["Rally","Trust","Drift","Turns"]) {
    const pair = original["rlMinus" + name];
    dataRow(historical, [name, interval(pair), pair.interval95[0] > -1 ? "Yes" : "No"]);
  }
  return [lead, interpretation, scrollTable(grid),
    note("Figures are mean net credits per shift with paired 95% intervals. A planner win requires a lower bound above zero. Both cold-reversal rows must also stay within one credit of Survey. The original drop must beat Survey and the planner and stay within one credit of each of four earlier agents."),
    disclosure("Check the original interrupted-drop gains",scrollTable(retention))];
}

function renderEvidence(release, weights) {
  const controlGrid = table(["Fresh market", "Versus equal weights", "Versus Planner → Survey", "Versus Rally → Survey"],
    "Paired mean credit differences when the comparison policies share the same final two decisions");
  const controls = controlGrid.createTBody();
  const fresh = release.comparisons.byStratumEnding;
  for (const [label, row] of [["Hot-ending drops", fresh["interrupted-drop"].hot], ["Cold-ending reversals", fresh.reversal.cold],
    ["Cold-ending drops", fresh["interrupted-drop"].cold], ["Hot-ending reversals", fresh.reversal.hot], ["All fresh shifts", release.comparisons.all]]) {
    dataRow(controls,[label,interval(row.rlMinusEqual),interval(row.rlMinusEarlyPlanner),interval(row.rlMinusEarlyRally)]);
  }
  const totals = table(["Fresh pattern", ...Object.values(names)], "Average net credits per shift on the fresh test patterns");
  const metrics = totals.createTBody();
  for (const [family, row] of Object.entries(release.comparisons.byFamily))
    dataRow(metrics, [BOOKING_PATTERNS[family].label, ...Object.keys(names).map(k => num(row[k],2))]);
  dataRow(metrics, ["All fresh shifts", ...Object.keys(names).map(k => num(release.comparisons.all[k],2))]);
  $("scorecard").replaceChildren(...targetEvidence(release), earlyEvidence(release.audit), identicalOffers(release, weights), matchedExample(weights),
    disclosure("Compare all reference policies",note("Planner → Survey and Rally → Survey use the named policy through wave six and the same frozen Survey policy afterwards. The equal-weight control fits the same value learner with equal weighting per training tape."),scrollTable(controlGrid),scrollTable(totals)),
    exampleLinks(release.cases, paired.picker.url));
  if (location.hash === "#early-decisions") requestAnimationFrame(() => $("early-decisions").scrollIntoView({ behavior: "instant" }));
}

mountDemandDesk({
  suite: BOOKING_SUITE, patterns: BOOKING_PATTERNS, picker: paired.picker, names, policies, world,
  checkpoints: ["booking", "survey", "rally", "trust", "closes", "drift", "turns"], weightsFrom: releases => bookingWeights(...releases),
  renderSignal, renderPair: renderReplay, renderEvidence, reportGroups: paired.reportGroups,
  verifyReport: (report, weights) => verifyInWorker(new URL("./lib/booking-report-worker.js", import.meta.url), report, weights),
});
