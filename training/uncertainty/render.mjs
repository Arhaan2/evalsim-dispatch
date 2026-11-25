import {readFile} from "node:fs/promises";
import {familyName, roundName} from "../../docs/lib/overnight-view.js";
import {digits, count, signed, percentage, stamp, comparison, table, renderCase, writeSections} from "../fleetweek/render-decisions.mjs";

const data = new URL("../../docs/data/uncertainty/", import.meta.url);
const result = JSON.parse(await readFile(new URL("results.json", data), "utf8"));
const fresh = result.splits.test, archive = result.splits.archive;
const full = fresh.summary.all;
const diagnostics = fresh.diagnostics;
const names = {rl:"Risk-aware agent", planner:"Rolling planner", override:"Previous override agent",
  meanOnly:"Same fit, no risk penalty", flatRisk:"Same fit, constant downside",
  overnight:"Earlier overnight RL", previous:"Original fleet RL"};

function riskEstimate(example, observed) {
  const e = example.estimates;
  return '<div class="risk-estimate"><p>Expected extra earnings <strong>' + signed(e.netGain) +
    ' credits</strong></p><p>Downside estimate <strong>' + digits(e.downside) +
    ' credits</strong></p></div><details><summary>How uncertain is this proposal?</summary>' +
    '<p>The previous agent recommends the override. The new model’s own mean forecast for this change is ' +
    signed(e.riskMean) + ' credits. Its downside estimate averages the amount by which the actual gain falls below that forecast, counting zero whenever the gain is higher.</p>' +
    '<p>The dispatcher blends its mean with the previous agent’s estimate to predict extra earnings. It estimates a change of ' +
    signed(e.serviceGain,3) + ' fulfilled contracts through Friday and applies a downside penalty of ' +
    digits(e.penalty) + ' credits. These forecasts assume the previous override agent handles later rounds.</p>' +
    '<p>Since Monday, freight has appeared at ' + observed + ', in that order.</p></details>';
}

const examples = diagnostics.examples;
const replays = examples.length ? '<div class="case-list" hidden><select id="case-select" aria-labelledby="replay-title">' +
  examples.map(item => '<option value="' + stamp(item) + '">' + roundName(item.epoch).replace(/^(Monday|Tuesday|Wednesday|Thursday)/,
    day => day.slice(0,3)) + ' · ' + item.seed + '</option>').join("") + '</select></div>' +
  examples.map(example => {
    const note = example.estimates.riskVeto ? " Removing the risk penalty would have changed the decision to taking the override." :
      " Removing the risk penalty would have produced the same decision here.";
    return renderCase(example, "./uncertainty.html", riskEstimate, note);
  }).join("\n") +
  '<p class="sample-note">Each replay comes from the middle of its group of helpful or costly decisions to accept or decline an override. Both branches see the same freight and follow the new agent after tonight.</p>' :
  '<p>There were no nonzero-credit examples of a proposal that earned a different Friday total. The scored decisions and weekly results are below.</p>';

const registered = [
  ["Fresh earnings (credits per week)", comparison(full.comparisons.planner), result.goals.freshProfit],
  ["Fresh on-time service (percentage points)", comparison(full.comparisons.planner,true), result.goals.freshService],
  ["Original double-return earnings (credits per week)", comparison(archive.summary.all.comparisons.planner), result.goals.doubleReturn],
];
const goals = table("Release minus rolling planner", ["Goal","Difference [paired 95% interval]","Registered test"],
  registered.map(([label,measure,pass])=>[label,measure,pass ? "Met" : "Missed"]));
const freshVerdict = result.goals.freshProfit && result.goals.freshService ? "The agent beat the planner and matched its on-time rate on fresh weeks." :
  result.goals.freshProfit ? "The agent beat the planner’s earnings on fresh weeks. The on-time match remains unproven." :
  result.goals.freshService ? "The agent matched the planner’s on-time rate on fresh weeks. The earnings advantage remains unproven." :
  "The fresh weeks established neither an earnings advantage nor an on-time service match.";
const returnVerdict = result.goals.doubleReturn ? "The double-return win held." : "The double-return win remains unproven for this agent.";
const perWeek = (delta,baseline) => delta === 0 ? "earned the same weekly net as " + baseline :
  "earned " + digits(Math.abs(delta)) + (delta>0 ? " more" : " fewer") + " net credits per week than " + baseline;

function weeklyTable(split,caption,keys) {
  return table(caption, ["Dispatcher","Net credits / week","Contracts on time","Net vs planner [95% interval]"], keys.map(key=>{
    const p=split.summary.all.policies[key];
    return [names[key],digits(p.net),percentage(p.onTime),key==="planner" ? "Reference" : comparison(split.versusPlanner[key])];
  }));
}
const comparisonTable = table("Risk-aware agent minus each dispatcher on fresh weeks",
  ["Compared with","Net credits / week [95% interval]","On-time difference in pp [95% interval]"],
  ["override","meanOnly","flatRisk"].map(key=>[names[key],comparison(full.comparisons[key]),comparison(full.comparisons[key],true)]));
const decisions = table("Effect of the chosen action at Friday close", ["Choice","Nights","Helped","Tied","Hurt","Mean net gain per decision"],
  [["Take the override",diagnostics.accept],["Keep the planner’s move",diagnostics.decline]].map(([name,g])=>
    [name,count(g.nights),count(g.helped),count(g.tied),count(g.hurt),g.nights?signed(g.netGain/g.nights):"—"]));
const bands = table("Candidate overrides by estimated downside", ["Downside band","Proposals","Accepted","Deferred","Mean predicted downside (credits)","Mean observed downside (credits)","Proposals earning less by Friday"],
  diagnostics.riskBands.map((group,i) => [["Lower","Middle","Higher"][i], count(group.nights), count(group.accepted), count(group.deferred),
    group.nights ? digits(group.meanPredictedDownside) : "—", group.nights ? digits(group.meanObservedDownside) : "—", group.nights ? percentage(100*group.lossRate) : "—"]));
const [low,,high] = diagnostics.riskBands;
const calibrationFinding = low.nights && high.nights ?
  ' The highest predicted-downside group had an observed mean shortfall of ' + digits(high.meanObservedDownside) +
  ' credits, compared with ' + digits(low.meanObservedDownside) + ' in the lowest group.' : '';
const schedules = table("Fresh schedules", ["Schedule","Weeks","Net vs planner [95% interval]","On-time difference in pp [95% interval]"],
  Object.entries(fresh.summary.byFamily).map(([key,g])=>[familyName(key),count(g.weeks),comparison(g.comparisons.planner),comparison(g.comparisons.planner,true)]));
const replicates = table("Five fits on the same weeks", ["Fit seed","Fresh net vs planner [95% interval]","Fresh on-time difference in pp [95% interval]","Double-return net vs planner [95% interval]"],
  fresh.fits.map((f,i)=>[String(f.seed)+(f.seed===result.primarySeed?" · release":""),comparison(f.planner),comparison(f.planner,true),comparison(archive.fits[i].planner)]));

const results = '<p class="finding"><strong>' + freshVerdict + '</strong> Across ' + count(full.weeks) +
  ' weeks from four unseen schedules, the agent earned ' + digits(full.policies.rl.net) + ' net credits per week and served ' +
  percentage(full.policies.rl.onTime) + ' of its contracts on time. The rolling planner earned ' + digits(full.policies.planner.net) +
  ' credits and served ' + percentage(full.policies.planner.onTime) + '.</p><p><strong>' + returnVerdict +
  '</strong> On ' + count(archive.summary.all.weeks) + ' new weeks from the original schedule, the agent ' +
  perWeek(archive.versusPlanner.rl.net,"the planner") + '.</p>' + goals +
  '<h3>What did the uncertainty estimate change?</h3><p>On the new agent’s path, the previous agent proposed changing the planner’s move on ' +
  count(diagnostics.eligible) + ' of ' + count(diagnostics.nights) + ' overnight boards. The risk-aware agent accepted ' +
  count(diagnostics.accept.nights) + ' proposals and kept the planner’s move on ' + count(diagnostics.decline.nights) +
  '. Removing the downside penalty changed ' + count(diagnostics.meanOnlyChanges) +
  ' decisions on those same boards. Replacing the individual estimates with one constant downside estimate changed ' +
  count(diagnostics.flatRiskChanges) + ' decisions. The paired weekly comparisons include the consequences through Friday.</p>' + comparisonTable +
  '<p>Against the same fit with a constant downside, the risk-aware agent’s average difference was ' +
  signed(full.comparisons.flatRisk.net,3) + ' credits per week (paired 95% interval ' +
  full.comparisons.flatRisk.net95.map(n=>signed(n,3)).join(' to ') + ').' + calibrationFinding + '</p>' +
  '<details><summary>Where did accepting or deferring help?</summary>' + decisions +
  '<p>A choice helped when it earned more by Friday than taking the other action on that board. A single week may supply multiple decisions.</p>' + bands +
  '<p>The two cutoffs, ' + diagnostics.riskCuts.map(x=>digits(x)).join(' and ') +
  ' credits, were fixed on calibration weeks. Observed downside uses the previous override agent after each fork, matching the forecast’s training target. The last column uses the new agent on both branches after that night and counts proposals that would earn less than the planner’s move.</p></details>' +
  '<details><summary>All seven dispatchers on fresh weeks</summary>' + weeklyTable(fresh,"Average over the fresh weeks",Object.keys(names)) + '</details>' +
  '<details><summary>Double-return results</summary>' + weeklyTable(archive,"New weeks on the original double-return schedule",Object.keys(names)) + '</details>' +
  '<details><summary>Four unseen schedules</summary>' + schedules + '</details><details><summary>All five training runs</summary>'+replicates+'</details>';

const feature = '<article class="latest-study" id="uncertainty" aria-labelledby="uncertainty-title"><div><h2 id="uncertainty-title">Trust this override?</h2><p>The previous agent recommends changing an overnight move. The new agent weighs how far the payoff could fall below its estimate. On ' +
  count(full.weeks) + ' fresh weeks it ' + perWeek(full.comparisons.planner.net,"the rolling planner") + '. ' + freshVerdict + ' ' + returnVerdict +
  '</p></div><figure class="load-distribution"><figcaption>Decisions on ' + count(diagnostics.eligible) + ' proposed overrides</figcaption>' +
  [["Take the override",diagnostics.accept.nights],["Keep the plan",diagnostics.decline.nights]].map(([label,n])=>
    '<div class="load-bin"><strong>' + label + '</strong><span>' + count(n) + '</span><div class="load-bar" aria-hidden="true"><i style="width:' +
    digits(diagnostics.eligible ? 100*n/diagnostics.eligible : 0) + '%"></i></div></div>').join("") +
  '</figure><nav aria-label="Uncertain overnight moves"><a href="./uncertainty.html">Make the call →</a><a href="./uncertainty.html#results">Read the results →</a><a href="./uncertainty.html#own-agent">Benchmark your agent →</a></nav></article>';

await writeSections("uncertainty","uncertainty.html",{replays,results});
await writeSections("uncertainty","studies.html",{feature});
