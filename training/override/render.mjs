import {readFile} from "node:fs/promises";
import {familyName,roundName} from "../../docs/lib/overnight-view.js";
import {digits,count,signed,percentage,stamp,comparison,sentenceForDelta,table,renderCase,writeSections} from "../fleetweek/render-decisions.mjs";

const docs = new URL("../../docs/", import.meta.url);
const read = async file => JSON.parse(await readFile(new URL(file, docs), "utf8"));
const result = await read("data/override/results.json");
const fresh = result.splits.test;
const archive = result.splits.archive;
const full = fresh.summary.all;
const names = {rl:"Override agent", planner:"Rolling planner", always:"Always override", overnight:"Earlier overnight RL", previous:"Original fleet RL", greedy:"Greedy dispatcher"};

function estimatesMarkup(example, observed) {
  const estimates = example.estimates;
  return '<details><summary>See observed demand and the agent’s estimates</summary><p>The freight hubs observed so far, in order, were ' + observed +
    '.</p><p>Compared with the planner’s move, the agent estimates ' + signed(estimates.netGain) + ' net credits and ' + signed(estimates.serviceGain) +
    ' fulfilled contracts for the alternative through Friday. These estimates use the public board and forecast, and assume the planner dispatches subsequent rounds.</p></details>';
}

const diagnostics = fresh.diagnostics;
const examples = diagnostics.examples;
const replays = examples.length ? '<div class="case-list" hidden><label for="case-select">Choose a night</label><select id="case-select">' +
  examples.map(item => '<option value="' + stamp(item) + '">' + roundName(item.epoch).replace(/^(Monday|Tuesday|Wednesday|Thursday)/, day => day.slice(0,3)) + ' · ' + item.seed + '</option>').join("") +
  '</select></div>' + examples.map(example => renderCase(example,"./override.html",estimatesMarkup)).join("\n") +
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

await writeSections("override","override.html", {replays, results});
await writeSections("override","studies.html", {feature});
