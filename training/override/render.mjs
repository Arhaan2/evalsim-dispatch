import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {FLEET_DEPOTS} from "../../docs/lib/fleetweek.js";
import {branchLabel, dispatchText, familyName, moveName, roundName, traceActions} from "../../docs/lib/overnight-view.js";

const docs = new URL("../../docs/", import.meta.url);
const read = async file => JSON.parse(await readFile(new URL(file, docs), "utf8"));
const result = await read("data/override/results.json");
const fresh = result.splits.test;
const archive = result.splits.archive;
const full = fresh.summary.all;
const digits = (value, places = 2) => value.toLocaleString("en-US", {minimumFractionDigits:places, maximumFractionDigits:places});
const count = value => digits(value, 0);
const signed = (value, places = 2) => (value > 0 ? "+" : "") + digits(value, places);
const percentage = value => digits(value) + "%";
const creditWord = n => n === 1 ? " credit" : " credits";
const stamp = item => [item.seed, item.epoch].join("-");
const names = {rl:"Override agent", planner:"Rolling planner", always:"Always override", overnight:"Earlier overnight RL", previous:"Original fleet RL", greedy:"Greedy dispatcher"};

function comparison(row, service = false) {
  const [point, bounds, places] = service ? [row.servicePP, row.service95, 3] : [row.net, row.net95, 2];
  return signed(point, places) + " [" + bounds.map(value => signed(value, places)).join(", ") + "]";
}

function sentenceForDelta(delta) {
  if (delta === 0) return "earned exactly as much as the rolling planner";
  return "earned " + digits(Math.abs(delta)) + (delta > 0 ? " more" : " fewer") + " net credits per week than the rolling planner";
}

function table(caption, headings, rows, className = "") {
  const head = headings.map(value => '<th scope="col">' + value + '</th>').join("");
  const body = rows.map(([first, ...rest]) => '<tr><th scope="row">' + first + '</th>' +
    rest.map(value => '<td>' + value + '</td>').join("") + '</tr>').join("");
  return '<div class="table-frame" role="region" tabindex="0" aria-label="' + caption + '"><table class="' + className +
    '"><caption>' + caption + '</caption><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function renderCase(example) {
  const {seed, epoch, family} = example;
  const accepted = example.choice === "accept";
  const branches = (accepted ? [example.alternative, example.chosen] : [example.chosen, example.alternative])
    .map(path => traceActions({seed, family}, path.actions));
  const [plan, proposal] = branches;
  const board = plan.trace[epoch].observation;
  assert.equal(plan.trace[epoch].action.id, example.plannerId);
  assert.equal(proposal.trace[epoch].action.id, example.proposalId);
  const forecast = board.forecast[epoch + 1].map((p, depot) => {
    const percent = Math.round(100 * p) + "%";
    return '<dt>' + FLEET_DEPOTS[depot] + '</dt><dd><span class="track" aria-hidden="true"><i style="--share:' +
      percent + '"></i></span><span>' + percent + '</span></dd>';
  }).join("");
  const trucks = board.positions.map((p, i) => {
    const current = plan.trace[epoch].action.moves[i];
    const signedLoad = current === "W" || current.startsWith("E") ? "available" : moveName(current, board, i);
    return '<p>Truck ' + (i + 1) + ' at ' + FLEET_DEPOTS[p] + ' · ' + signedLoad + '</p>';
  }).join("");
  const choiceNames = ["Keep the plan", "Override"];
  const options = branches.map((path, i) => {
    const frame = path.trace[epoch];
    const price = frame.action.emptyCost;
    return {name:choiceNames[i], label:branchLabel(frame) + " · " + price + creditWord(price), net:path.ledger.net};
  });
  const decisions = options.map((option, i) => '<div class="shift-choice"><button type="button" data-pick="' +
    (i === 0 ? "planner" : "override") + '" data-net="' + option.net + '" aria-pressed="false"><strong>' +
    option.name + '</strong><span>' + option.label + '</span></button></div>').join("");
  const where = example.choice === "accept" ? "overrode the planner" : "kept the planner’s move";
  const net = proposal.ledger.net - plan.ledger.net;
  const service = proposal.ledger.served - plan.ledger.served;
  const outcome = net === 0 ? "Both choices earned the same amount through Friday." :
    "Overriding the planner earned " + count(Math.abs(net)) + (net > 0 ? " more" : " fewer") + " net credits through Friday.";
  const impact = service === 0 ? "Both served the same number of contracts." :
    "The override served " + count(Math.abs(service)) + (service > 0 ? " more" : " fewer") + (Math.abs(service) === 1 ? " contract." : " contracts.");
  const totals = table("Same freight through Friday", ["Tonight’s choice", "Empty trip cost", "Next morning’s net", "Week net", "On time"],
    branches.map((path,i) => [choiceNames[i], count(path.trace[epoch].action.emptyCost), count(path.trace[epoch + 1].action.net), count(path.ledger.net), path.ledger.served + " / 10"]));
  const journey = table("Actions for truck 1 and truck 2", ["Round", "Keep the plan", "Override"], plan.trace.map((_, t) =>
    [roundName(t), ...branches.map(path => dispatchText(path.trace[t]) + " · " + path.trace[t].action.net + " net")]), "journey");
  const estimates = example.estimates;
  const observed = [...board.history.map(item => item.hub), board.hub].map(hub => FLEET_DEPOTS[hub]).join(" → ");
  return '<article class="night-case" data-case="' + stamp(example) + '"><h3>' + roundName(epoch) + '</h3>' +
    '<div class="manifest"><div><h4>Trucks and signed loads</h4>' + trucks + '</div><div><h4>Next morning’s demand forecast</h4><dl class="forecast">' + forecast + '</dl></div></div>' +
    '<details><summary>See observed demand and the agent’s estimates</summary><p>The freight hubs observed so far, in order, were ' + observed +
    '.</p><p>Compared with the planner’s move, the agent estimates ' + signed(estimates.netGain) + ' net credits and ' + signed(estimates.serviceGain) +
    ' fulfilled contracts for the alternative through Friday. These estimates use the public board and forecast, and assume the planner dispatches subsequent rounds.</p></details>' +
    '<div class="call-row shift-choices" hidden>' + decisions + '</div><noscript><ul>' + options.map(option => '<li>' + option.name + ' · ' + option.label + '</li>').join("") + '</ul></noscript>' +
    '<p class="call-status" role="status"></p><details class="outcome"><summary>Reveal both Friday outcomes</summary><p><strong>' + outcome + '</strong> ' + impact +
    ' The trained agent ' + where + '.</p>' + totals + '<details><summary>Follow both trucks through all ten rounds</summary>' + journey +
    '</details><p class="sample-note">Week ' + seed + ' · ' + familyName(family) + '</p></details><a class="case-link" href="./override.html?case=' +
    stamp(example) + '#replays">Link to this night</a></article>';
}

const diagnostics = fresh.diagnostics;
const examples = diagnostics.examples;
const replays = examples.length ? '<div class="case-list" hidden><label for="case-select">Choose a night</label><select id="case-select">' +
  examples.map(item => '<option value="' + stamp(item) + '">' + roundName(item.epoch).replace(/^(Monday|Tuesday|Wednesday|Thursday)/, day => day.slice(0,3)) + ' · ' + item.seed + '</option>').join("") +
  '</select></div>' + examples.map(renderCase).join("\n") +
  '<p class="sample-note">Each replay is closest to the middle of its group of overrides or decisions to keep the plan that helped or hurt. In the actual replay, both paths see identical freight and use the trained policy after tonight.</p>' :
  '<p>No eligible decision produced a different Friday earnings total. Full-week scores appear below.</p>';

const policyTable = table("Average performance on " + count(full.weeks) + " fresh weeks",
  ["Dispatcher", "Net credits / week", "Contracts on time", "Empty miles / week"], Object.entries(names).map(([key, name]) => {
    const row = full.policies[key];
    return [name, digits(row.net), percentage(row.onTime), digits(row.emptyMiles)];
  }));
const tests = table("Goals fixed before training", ["Goal", "Difference from planner [paired 95% interval]", "Result"], [
  ["Fresh-week earnings (credits)", comparison(full.comparisons.planner), result.goals.freshProfit],
  ["Fresh on-time rate (percentage points)", comparison(full.comparisons.planner, true), result.goals.freshService],
  ["Original double-return earnings (credits)", comparison(archive.summary.all.comparisons.planner), result.goals.doubleReturn],
].map(([label, number, passed]) => [label, number, passed ? "Met" : "Missed"]));
const decisions = table("Chosen action versus the other action on the same night", ["Agent’s choice", "Nights", "Helped", "Tied", "Hurt", "Mean net gain per decision"],
  [["Override", diagnostics.accept], ["Keep the plan", diagnostics.decline]].map(([name, g]) =>
    [name, count(g.nights), count(g.helped), count(g.tied), count(g.hurt), g.nights ? signed(g.netGain / g.nights) : "—"]));
const archived = table("Original double-return schedule on " + count(archive.summary.all.weeks) + " new weeks",
  ["Dispatcher", "Net credits / week", "Contracts on time", "Net vs planner [95% interval]"], ["rl", "planner", "overnight", "previous"].map(key => {
    const row = archive.summary.all.policies[key];
    const pair = key === "planner" ? null : archive.versusPlanner[key];
    return [names[key], digits(row.net), percentage(row.onTime), pair ? comparison(pair) : "Reference"];
  }));
const families = table("Fresh schedule results", ["Schedule","Weeks","Net credits vs planner [95% interval]","On-time difference in pp [95% interval]"],
  Object.entries(fresh.summary.byFamily).map(([key, row]) => [familyName(key), count(row.weeks), comparison(row.comparisons.planner), comparison(row.comparisons.planner, true)]));
const seeds = table("Fits evaluated on identical weeks", ["Seed", "Fresh net credits", "On time", "Fresh net vs planner [95% interval]", "Double-return net vs planner [95% interval]"],
  fresh.fits.map((fit,i) => [fit.seed + (fit.seed === result.primarySeed ? " · release" : ""), digits(fit.net), percentage(fit.onTime), comparison(fit.planner), comparison(archive.fits[i].planner)]));
const summary = sentenceForDelta(full.comparisons.planner.net);
const returnDelta = archive.summary.all.comparisons.planner.net;
const recovery = result.goals.doubleReturn ?
  "On " + count(archive.summary.all.weeks) + " fresh double-return weeks, the agent recovered a gain of " + digits(returnDelta) + " credits per week over the planner." :
  "On " + count(archive.summary.all.weeks) + " fresh double-return weeks, its difference from the planner was " + signed(returnDelta) + " credits per week.";
const unresolved = !result.goals.freshProfit && !result.goals.freshService ?
  "Across the four unseen schedules, both the earnings advantage and the on-time match remained unproven." : "";
const results = '<p class="finding"><strong>The override agent ' + summary + '.</strong> It served ' + percentage(full.policies.rl.onTime) + ' of contracts on time, compared with ' +
  percentage(full.policies.planner.onTime) + ' for the planner. ' + unresolved + '</p><p><strong>' + recovery + '</strong> The original fleet agent earned ' + signed(archive.versusPlanner.previous.net) + ' and the earlier overnight agent earned ' + signed(archive.versusPlanner.overnight.net) + ' credits per week against the same planner on those weeks.</p>' + tests +
  '<h3>When did the agent step in?</h3><p>On ' + count(diagnostics.eligible) + ' eligible nights, the agent changed the plan ' + count(diagnostics.accept.nights) + ' times and kept it ' + count(diagnostics.decline.nights) +
  ' times. “Helped” means that choice earned more by Friday than the other action on the same board. Several decisions can come from the same week.</p>' + decisions +
  '<p>Starting each dispatcher on Monday and scoring through Friday, the override agent earned ' + comparison(full.comparisons.always) + ' credits per week relative to overriding every eligible night. The interval covers the paired weekly difference.</p>' +
  '<details><summary>Compare all six dispatchers</summary>' + policyTable + '</details><details><summary>Double-return recovery</summary>' + archived + '</details>' +
  '<details><summary>Four unseen schedules</summary>' + families + '</details><details><summary>All five training runs</summary>' + seeds + '</details>';

const feature = '<article class="latest-study" id="override" aria-labelledby="override-title"><div><h2 id="override-title">Override the planner?</h2><p>On ' +
  count(full.weeks) + ' fresh weeks the trained agent ' + summary + '. ' + unresolved + ' ' + recovery + '</p></div><figure class="load-distribution"><figcaption>Decisions on ' +
  count(diagnostics.eligible) + ' eligible nights</figcaption>' + [["Override", diagnostics.accept.nights], ["Keep the plan", diagnostics.decline.nights]].map(([name, value]) =>
    '<div class="load-bin"><strong>' + name + '</strong><span>' + count(value) + '</span><div class="load-bar" aria-hidden="true"><i style="width:' +
    digits(diagnostics.eligible ? 100 * value / diagnostics.eligible : 0) + '%"></i></div></div>').join("") +
  '</figure><nav aria-label="Overnight planner overrides"><a href="./override.html">Make the call →</a><a href="./override.html#results">Read the results →</a><a href="./override.html#own-agent">Benchmark your agent →</a></nav></article>';

async function update(file, blocks) {
  const path = new URL(file, docs), before = await readFile(path, "utf8");
  let after = before;
  for (const [marker, content] of Object.entries(blocks)) {
    const start = '<!-- override-' + marker + '-start -->', end = '<!-- override-' + marker + '-end -->';
    const a = after.indexOf(start), b = after.indexOf(end);
    assert(a >= 0 && b > a, file + " is missing its " + marker + " section");
    after = after.slice(0, a + start.length) + "\n" + content + "\n" + after.slice(b);
  }
  if (process.argv.includes("--check")) assert.equal(after, before, file + " differs from measured results");
  else await writeFile(path, after);
}
await update("override.html", {replays, results});
await update("studies.html", {feature});
