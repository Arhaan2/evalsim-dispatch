import {readFile} from "node:fs/promises";
import {familyName, roundName} from "../../docs/lib/overnight-view.js";
import {
  comparison, count, digits, percentage, renderCase, signed, stamp, table, writeSections,
} from "../fleetweek/render-decisions.mjs";

const resultsPath = new URL("../../docs/data/loss/results.json", import.meta.url);
const result = JSON.parse(await readFile(resultsPath, "utf8"));
const modelPath = new URL("model-" + result.primarySeed + ".json", resultsPath);
const {settings} = JSON.parse(await readFile(modelPath, "utf8"));
const {test: fresh, archive} = result.splits;
const all = fresh.summary.all;
const diag = fresh.diagnostics;
const classifier = diag.classifier;
const goals = result.goals;
const names = {
  rl: "Loss-aware agent", planner: "Rolling planner", flatRisk: "Published constant penalty",
  constantLoss: "Same fit, constant loss probability", uncertainty: "Earlier risk-aware agent",
  override: "Previous override agent", previous: "Original fleet RL",
};
const rate = (p, places = 1) => p == null ? "—" : digits(100 * p, places) + "%";
const value = (n, places) => n == null ? "—" : digits(n, places);
const actionName = (id, example) => id === example.plannerId ? "kept the planner’s move" : "took the override";

function forecast(example, observed) {
  const e = example.estimates;
  return '<div class="risk-estimate"><p>Chance of earning less than the plan <strong>' + rate(e.lossProbability) +
    '</strong></p><p>Expected net change <strong>' + signed(e.expectedNet) +
    ' credits</strong></p></div><details><summary>What counts as a loss?</summary>' +
    '<p>A loss means the override earns fewer net credits by Friday than keeping the planner’s move tonight. A tie counts as a non-loss. For this forecast, the published constant-penalty agent handles every later round on both paths.</p>' +
    '<p>The model estimates a loss would cost ' + digits(e.lossSize) +
    ' credits on average. Across ties and wins, it expects an average gain of ' + digits(e.nonLossGain) +
    ' credits. It also estimates a change of ' + signed(e.serviceGain, 3) +
    ' fulfilled contracts through Friday.</p><p>The released agent gives this net forecast ' + rate(settings.blend, 0) +
    ' of the weight and the earlier agent’s net forecast ' + rate(1 - settings.blend, 0) +
    '. It adds ' + digits(settings.serviceCredit, 0) + ' credits per expected extra contract and requires a score above ' +
    digits(settings.hurdle, 0) + ' credits to change the plan.</p><p>Since Monday, freight has appeared at ' + observed + ', in that order.</p></details>';
}

function renderReplays(examples) {
  if (!examples.length) return '<p>Every eligible decision produced a tie through Friday, or there were no proposals. The weekly scores are below.</p>';
  const choices = examples.map(item => '<option value="' + stamp(item) + '">' +
    roundName(item.epoch).replace(/^\w+/, day => day.slice(0, 3)) + ' · ' + item.seed + '</option>');
  const cases = examples.map(item => {
    const delta = item.targetNetDifference;
    const note = ' On this board the published constant penalty ' + actionName(item.estimates.flatRiskId, item) +
      '. Under the constant-penalty continuation used to label the forecast, the override’s Friday difference was ' +
      signed(delta, 0) + ' credits (' + (delta < 0 ? "loss" : delta === 0 ? "tie" : "gain") + ').';
    return renderCase(item, "./loss.html", forecast, note);
  });
  return '<div class="case-list" hidden><select id="case-select" aria-labelledby="replay-title">' + choices.join("") +
    '</select></div>' + cases.join("\n") +
    '<p class="sample-note">Each replay shows the middle outcome in a group of helpful or costly calls to accept or decline. Both paths see the same freight arrivals through Friday and hand later decisions to the loss-aware agent.</p>';
}

const checks = [
  ["Fresh earnings vs constant penalty", comparison(all.comparisons.flatRisk), "credits per week", goals.freshFlatProfit],
  ["Fresh earnings vs rolling planner", comparison(all.comparisons.planner), "credits per week", goals.freshProfit],
  ["Fresh on-time rate vs constant penalty", comparison(all.comparisons.flatRisk, true), "percentage points", goals.freshFlatService],
  ["Fresh on-time rate vs rolling planner", comparison(all.comparisons.planner, true), "percentage points", goals.freshService],
  ["Double-return earnings vs rolling planner", comparison(archive.summary.all.comparisons.planner), "credits per week", goals.doubleReturn],
];
const goalsTable = table("Registered tests", ["Measure", "Difference [paired 95% interval]", "Units", "Test"],
  checks.map(([name, delta, units, pass]) => [name, delta, units, pass ? "Met" : "Missed"]));

function earningsFinding() {
  if (goals.freshFlatProfit && goals.freshProfit) return "The loss-aware agent beat both earnings baselines on fresh weeks.";
  if (goals.freshFlatProfit) return "The loss-aware agent beat the constant penalty on fresh earnings. Its advantage over the rolling planner remains unproven.";
  if (goals.freshProfit) return "The loss-aware agent beat the rolling planner on fresh earnings. Its advantage over the constant penalty remains unproven.";
  return "The fresh weeks did not establish an earnings win over either baseline.";
}
const serviceFinding = goals.freshService && goals.freshFlatService ? "It matched both baselines on on-time service." :
  goals.freshService ? "It matched the planner on service. The service match against the constant penalty remains unproven." :
  goals.freshFlatService ? "It matched the constant penalty on service. The planner service match remains unproven." :
  "The service tests did not establish a match with either baseline.";
const archiveFinding = goals.doubleReturn ? "The double-return earnings win held." : "The double-return earnings win remains unproven.";

function policyTable(split, title) {
  const pool = split.summary.all;
  return table(title, ["Dispatcher", "Net credits / week", "Contracts on time", "Net vs planner [95% interval]", "Net vs constant penalty [95% interval]"],
    Object.entries(names).map(([key, name]) => {
      const policy = pool.policies[key];
      return [name, digits(policy.net), percentage(policy.onTime),
        key === "planner" ? "Reference" : comparison(split.versusPlanner[key]),
        key === "flatRisk" ? "Reference" : comparison(split.versusFlatRisk[key])];
    }));
}

const scoreTable = table("Predictions on fresh overnight proposals", ["Predicted loss range", "Proposals", "Predicted on average", "Observed losses"],
  classifier.bins.map((bin, i) => [
    rate(bin.lower, 0) + (i === classifier.bins.length - 1 ? " to " : " to &lt;") + rate(bin.upper, 0),
    count(bin.n), rate(bin.meanPredicted), rate(bin.lossRate),
  ]));
const decisions = table("Friday impact of accepting or declining the proposal",
  ["Decision", "Nights", "Earned more", "Tied", "Earned less", "Mean net gain"],
  [["Take the override", diag.accept], ["Keep the plan", diag.decline]].map(([name, g]) =>
    [name, count(g.nights), count(g.helped), count(g.tied), count(g.hurt), g.nights ? signed(g.netGain / g.nights) : "—"]));
const weeklyOutcomes = table("Weekly net earnings for the loss-aware agent", ["Compared with", "Won", "Tied", "Lost"],
  [["Fresh weeks · rolling planner", all.comparisons.planner], ["Fresh weeks · constant penalty", all.comparisons.flatRisk],
    ["Double-return weeks · rolling planner", archive.summary.all.comparisons.planner]].map(([name, c]) =>
    [name, count(c.wins), count(c.ties), count(c.losses)]));
const families = table("Unseen schedules", ["Schedule", "Weeks", "Net vs constant penalty [95% interval]", "Net vs planner [95% interval]", "On-time vs planner in pp [95% interval]"],
  Object.entries(fresh.summary.byFamily).map(([id, g]) =>
    [familyName(id), count(g.weeks), comparison(g.comparisons.flatRisk), comparison(g.comparisons.planner), comparison(g.comparisons.planner, true)]));
const replicates = table("Five fits on identical weeks", ["Fit seed", "Fresh net vs constant penalty", "Fresh net vs planner", "Fresh on-time vs planner in pp", "Double-return net vs planner"],
  fresh.fits.map(f => [f.seed + (f.seed === result.primarySeed ? " · release" : ""), comparison(f.flatRisk),
    comparison(f.planner), comparison(f.planner, true), comparison(archive.fits.find(row => row.seed === f.seed).planner)]));
const largestBand = classifier.bins.reduce((largest, bin) => bin.n > largest.n ? bin : largest);
const classifierText = '<p>On ' + count(classifier.n) + ' eligible proposals the average predicted loss probability was ' +
  rate(classifier.meanPredicted) + '. In the paired simulator runs, ' + count(classifier.losses) +
  ' proposals lost (' + rate(classifier.prevalence) + ') and ' + count(classifier.ties) + ' tied. Each label compares the two moves under the same constant-penalty continuation.</p>' +
  '<p>The probability model’s Brier score was <strong>' + value(classifier.brier, 4) +
  '</strong>. Always predicting the calibration loss rate of ' + rate(classifier.constantProbability) + ' scored ' +
  value(classifier.constantBrier, 4) + '. This score averages squared probability error, so smaller values are better. ' +
  (classifier.auc == null ? 'Computing a ranking score requires both losses and non-losses.' :
    'Its AUROC was <strong>' + digits(classifier.auc, 3) + '</strong>. That measures how often a loss receives a higher risk estimate than a non-loss, giving half credit for tied predictions. Random ordering averages 0.5.') + '</p>';
const concentration = '<p><strong>' + count(largestBand.n) + ' of ' + count(classifier.n) +
  ' forecasts fell in the ' + rate(largestBand.lower, 0) + '–' + rate(largestBand.upper, 0) +
  ' range.</strong> Using a separate loss probability for each board changed ' + count(diag.constantLossChanges) +
  ' decisions compared with always using the training-calibration loss rate on those same boards.</p>';

const results = '<p class="finding"><strong>' + earningsFinding() + '</strong> On ' + count(all.weeks) +
  ' weeks across four unseen schedules, the agent earned ' + digits(all.policies.rl.net) + ' net credits per week. The constant penalty earned ' +
  digits(all.policies.flatRisk.net) + ' and the rolling planner earned ' + digits(all.policies.planner.net) + '.</p><p>' +
  serviceFinding + ' The agent delivered ' + percentage(all.policies.rl.onTime) + ' of contracts on time, compared with ' +
  percentage(all.policies.planner.onTime) + ' for the planner. ' + archiveFinding + ' The archive contains ' +
  count(archive.summary.all.weeks) + ' new weeks on the original double-return schedule.</p><div id="goals">' + goalsTable + '</div>' +
  '<details><summary>How often did the agent win a week?</summary>' + weeklyOutcomes + '</details>' +
  '<h3>How well did the agent spot losses?</h3>' + concentration + classifierText +
  '<details><summary>Compare predicted and observed loss rates</summary>' + scoreTable +
  '<p>Each row groups proposals by the probability shown before the move. An empty group has no observed loss rate.</p></details>' +
  '<details><summary>When did trusting the planner help?</summary><p>The model evaluated ' + count(diag.eligible) +
  ' proposals on ' + count(diag.nights) + ' overnight boards. It chose differently from the published constant penalty on ' +
  count(diag.flatRiskChanges) + ' eligible boards.</p>' + decisions +
  '<p>Each decision compares both moves with the release agent serving out the week on both paths. A week can contribute several decisions. As a full policy, the loss-aware agent earned ' +
  signed(all.comparisons.constantLoss.net, 3) + ' extra credits per fresh week over the same fit with a constant loss probability (paired 95% interval ' +
  all.comparisons.constantLoss.net95.map(x => signed(x, 3)).join(' to ') + ').</p></details>' +
  '<details><summary>All seven dispatchers on fresh weeks</summary>' + policyTable(fresh, "Fresh weeks") + '</details>' +
  '<details><summary>Double-return results</summary>' + policyTable(archive, "New weeks on the original double-return schedule") + '</details>' +
  '<details><summary>Four unseen schedules</summary>' + families + '</details><details><summary>All five training runs</summary>' +
  replicates + '<p>Brackets give paired 95% intervals on the same weeks for each fit.</p></details>';

const feature = '<article class="latest-study" id="loss" aria-labelledby="loss-title"><div><h2 id="loss-title">Will this override lose to the planner?</h2>' +
  '<p>A fleet agent estimates the chance that moving an empty truck overnight will cost it earnings by Friday. ' +
  earningsFinding() + ' ' + serviceFinding + ' ' + archiveFinding + '</p></div>' +
  '<figure class="load-distribution"><figcaption>Losses on ' + count(classifier.n) + ' fresh proposals</figcaption>' +
  [["Model forecast", classifier.meanPredicted], ["Observed loss rate", classifier.prevalence]].map(([label, share]) =>
    '<div class="load-bin"><strong>' + label + '</strong><span>' + rate(share) + '</span><div class="load-bar" aria-hidden="true"><i style="width:' +
    digits(100 * (share ?? 0)) + '%"></i></div></div>').join("") + '</figure><nav aria-label="Overnight loss prediction">' +
  '<a href="./loss.html">Make the call →</a><a href="./loss.html#results">Read the results →</a><a href="./loss.html#own-agent">Benchmark your agent →</a></nav></article>';
await writeSections("loss", "loss.html", {replays: renderReplays(diag.examples), results});
await writeSections("loss", "studies.html", {feature});
