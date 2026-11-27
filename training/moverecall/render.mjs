import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verifyMoveRecallReport} from "../../docs/lib/moverecall-benchmark.js";
import {familyName} from "../../docs/lib/overnight-view.js";
import {closurePlay} from "../closure/challenge.mjs";
import {interval,section,baselineTable,registeredTests,dispatcherTable,writeSampleReport} from "../closure/repair-tables.mjs";
import {verdict,defaultTable,primaryTable,decisionTables} from "../closure/switch-tables.mjs";
import {table,count,digits,signed,writeSections} from "../fleetweek/render-decisions.mjs";

const data=new URL("../../docs/data/moverecall/",import.meta.url);
const load=async name=>JSON.parse(await readFile(new URL(name+".json",data),"utf8"));
const result=await load("results");
const models=new Map(await Promise.all(result.fitSeeds.map(async seed=>[seed,await load("fit-"+seed)])));
const release=models.get(result.primarySeed);
const {test:fresh,validation,clean,archive}=result.splits;
const all=fresh.summary.all, comparison=all.comparisons, detection=fresh.detection, d=fresh.diagnostics;
const now=detection.all, before=now.previous, pair=now.vsPrevious;
const names={rl:"Move-recall RL",previous:"Previous detector",shortGate:"Short-trained default",longGate:"Long-trained alternative",
  planner:"Rolling planner",flatRisk:"Constant penalty",flatGate:"Constant predictions"};
const percent=n=>n==null?"Undefined":digits(100*n,1)+"%";
const level=(value,range)=>range?percent(value)+' ['+range.map(percent).join(', ')+']':percent(value);
const scalar=n=>n==null?"Undefined":digits(n,3);
const pp=n=>n==null?"Undefined":signed(100*n,2);
function recallInterval(c) {
  if (!c.recall95 || c.recallDifference==null) return "Undefined";
  return pp(c.recallDifference)+" ["+c.recall95.map(pp).join(", ")+"]";
}
const {tests,registered}=registeredTests(all,archive,result.goals,recallInterval(pair));
const passed=tests.filter(t=>t[3]).length+Number(result.goals.recall);
const {decisions,eachLength}=decisionTables(d,{service:true});
const recallVerdict=result.goals.recall?"The new policy caught a larger share of profitable switches.":pair.newlyLost===0 && pair.recovered===0 ?
  "The new and previous policies caught exactly the same profitable switches." : "The paired test did not establish higher recall.";
const weeklyVerdict=[comparison.shortGate,comparison.flatRisk,comparison.planner].every(c=>c.net95[0]<=0&&c.net95[1]>=0) ?
  "Earnings against always short, the constant penalty and the planner were all inconclusive." :
  "Weekly earnings met "+[result.goals.freshShortProfit,result.goals.freshFlatProfit,result.goals.freshProfit].filter(Boolean).length+" of the three registered baseline targets.";
const lead='<p class="finding"><strong>'+recallVerdict+'</strong> The release found '+count(now.tp)+' of '+count(now.profitable)+' profitable moves on the same fresh opportunities where the previous detector found '+
  count(before.tp)+'. The recall difference was '+recallInterval(pair)+' percentage points.</p>';
const recallComparison=table("Both policies on identical opportunities",["Measure","Previous detector","Move-recall RL"],
  [["Profitable moves caught",count(before.tp)+" / "+count(now.profitable),count(now.tp)+" / "+count(now.profitable)],
   ["Recall [95% interval]",level(before.recall,pair.previousRecall95),level(now.recall,pair.newRecall95)],["Precision of long choices",percent(before.precision),percent(now.precision)],
   ["Profitable moves missed",count(before.fn),count(now.fn)],["Switches that tied",count(before.switchedTies),count(now.switchedTies)],
   ["Switches that cost credits",count(before.switchedCostly),count(now.switchedCostly)]],"opportunity-counts");
const rediscovery='<p>Of '+count(pair.previousMisses)+' profitable moves skipped by the previous detector on these weeks, the new rule recovered '+count(pair.recovered)+
  ' ('+percent(pair.recoveryRate)+'). It lost '+count(pair.newlyLost)+' earlier hits. Both policies caught '+count(pair.bothCaught)+' and both missed '+count(pair.missedByBoth)+
  '. Recall uses all '+count(pair.profitable)+' profitable alternatives as its denominator. Precision is the share of chosen switches that paid off.</p>';
const ranking='<p>The release switched on '+count(now.switched)+' of '+count(now.n)+' boards, up from '+count(before.switched)+'. Its forecasts ranked profitable moves ahead of other moves about as often as before (AUROC '+
  scalar(now.auroc)+' versus '+scalar(before.auroc)+'). The two ranking estimates give no clear evidence of improvement. Choosing long more often recovered more wins and exposed the fleet to more losses.</p>';
const scope='<p>The comparison follows the short-trained fleet from Monday and records all '+count(pair.n)+' boards where its two experts disagreed. To label a switch, the evaluator tries short and long with the same future freight and uses short on both branches from the next board to Friday. Actual repair length stays hidden when choosing. The 67 misses in the earlier study motivated this experiment. They were excluded from training and evaluation.</p>';
async function additionalCredits() {
  const bank=await load("test"), index=result.fitSeeds.indexOf(result.primarySeed);
  let gains=0, losses=0, switches=0;
  for (const week of bank.cases) for (const board of week.opportunities) {
    if (board.previous.switched || !board.predictions[index].switched) continue;
    const difference=board.alternative.ledger.net-week.shortGate.ledger.net;
    gains+=Math.max(0,difference);
    losses+=Math.min(0,difference);
    switches++;
  }
  assert.equal(switches,pair.added.n);
  assert.equal(gains+losses,pair.added.credits);
  return {gains,losses};
}
const credits=await additionalCredits();
const added='<p>Of the '+count(pair.added.n)+' additional long choices, '+count(pair.added.wins)+' wins earned '+count(credits.gains)+' extra credits, '+count(pair.added.costly)+
  ' losses cost '+count(-credits.losses)+' credits and '+count(pair.added.ties)+' choices tied. Together these moves changed Friday earnings by '+signed(pair.added.credits,0)+' credits and deliveries by '+signed(pair.added.contracts,0)+' contracts.</p>';
const effects=table("What changed on the fixed short-trained path?",["Change from previous detector","Choices","Long earned more","Tied","Long earned less","Total long minus short credits","Change in contracts served"],
  [["New long choices",pair.added],["Removed long choices",pair.dropped]].map(([label,o])=>[label,count(o.n),count(o.wins),count(o.ties),count(o.costly),signed(o.credits,0),signed(o.contracts,0)]));
function recallGroups(title, groups) {
  return table(title,["Group","Disagreements","Profitable moves","Previous hits","New hits","Recovered","Lost","Difference in recall [paired 95% interval], pp"],
    groups.map(([label,g])=>[label,count(g.n),count(g.profitable),count(g.previous.tp),count(g.tp),count(g.vsPrevious.recovered),
      count(g.vsPrevious.newlyLost),recallInterval(g.vsPrevious)]));
}
const lengthDet=[["1–3 half-days",detection.durationGroups.short],["4–5 half-days",detection.durationGroups.long]];
const familyDet=Object.entries(detection.byFamily).map(([family,g])=>[familyName(family),g]);
const learned=detection.priorSkipped;
const calibration=table("Probability forecasts on boards the previous detector skipped",["Measure","Previous detector","Move-recall RL"],
  [["Ranking (AUROC)",scalar(learned.previous.auroc),scalar(learned.auroc)],["Probability error (Brier score)",scalar(learned.previous.brier),scalar(learned.brier)],
   ["Error from its training-prevalence forecast",scalar(learned.previous.baseBrier),scalar(learned.baseBrier)]]);
function forecastEstimate(value,ci) {
  return ci ? scalar(value)+" ["+ci.map(scalar).join(", ")+"]" : scalar(value);
}
const forecastGroups=table("New model’s probability forecasts",["Fixed-path opportunities","Ranking [95% interval]","Reduction in probability error vs training prevalence [95% interval]"],
  [["All disagreements",now],["Previous detector skipped",learned],...lengthDet].map(([name,g])=>
    [name,forecastEstimate(g.auroc,g.uncertainty.auroc95),forecastEstimate(g.uncertainty.brierGain,g.uncertainty.brierGain95)]));
const modelNote='<p>On a board the old rule would skip, the release searches its fit data for the 64 most similar public freight and repair situations. It estimates the win probability, extra credits, downside and service change from their measured Friday outcomes. The training used '+count(release.fitExamples)+
  ' new paired decisions across '+count(release.fitWeeks)+' fitting weeks. Both policies protect the predecessor’s long choice whenever they see the same board.</p>';
const rule=release.settings.priorOnly?
  '<p>Training selected the previous detector’s decision rule. The new estimated returns could be evaluated, but the deployed policy kept the previous decision on every board.</p>':
  '<p>On a previously skipped move, switching requires an estimated win probability of at least '+percent(release.settings.minWin)+' and a score strictly above '+digits(release.settings.hurdle,0)+
  ' credits. Start with expected net credits, add 12 credits per additional contract expected on time and subtract '+digits(release.settings.lossPenalty,2)+' times the expected downside. The rule was selected on '+count(release.selection.weeks)+' separate weeks.</p>';
const netHead=release.calibration.net.slope===0 ? '<p>Calibration set the release’s direct earnings slope to zero. It predicted '+signed(release.calibration.net.mean,3)+
  ' extra credits on every previously skipped board. The predicted win probability, service change and downside varied across boards and determined which additional moves qualified.</p>' : '';
const constantScore=release.calibration.net.mean+12*release.calibration.service.mean-release.settings.lossPenalty*release.calibration.downside.mean;
const flatAlwaysLong=!release.settings.priorOnly && release.calibration.win.mean>=release.settings.minWin && constantScore>release.settings.hurdle;
const ablation='<p>The control that replaces the learned forecasts with calibration averages '+(flatAlwaysLong?
  'takes every previously skipped long move. It follows the long-trained expert on all disagreements.':'applies those constant forecasts on every previously skipped move.')+
  ' The release earned '+interval(comparison.flatGate)+' credits/week relative to that control, with an on-time difference of '+interval(comparison.flatGate,true)+' percentage points.</p>';
const sampleNote="The evaluator paired both possible moves on "+count(d.forked)+" disagreements reached by the released agent. Each example is nearest its group’s median Friday earnings difference. The released agent makes every later decision on both paths.";
const play=fresh.examples.length ? closurePlay(fresh.examples,{study:"moverecall",sampleNote}) :
  '<p>Both frozen experts agreed on every board reached by the release, so these weeks produced no disputed move to replay.</p>';
const comparisons=primaryTable(comparison);
const earned=comparison.previous.net*all.weeks;
const costImpact='<p>On '+count(all.weeks)+' independently played fresh weeks, the released fleet earned '+signed(earned,0)+' total credits relative to the previous detector, a difference of '+interval(comparison.previous)+
  ' credits per week. '+weeklyVerdict+' The release met '+count(passed)+' of eight registered tests.</p>';
const service='<p>The on-time service target was '+(result.goals.freshShortService?"met":"missed")+' against always short, '+(result.goals.freshFlatService?"met":"missed")+' against the constant penalty and '+
  (result.goals.freshService?"met":"missed")+' against the planner. Service differences are percentage points of the ten contracts due per week. Brackets give paired 95% intervals.</p>';
const archiveResult='<p>On '+count(archive.summary.all.weeks)+' fresh closure-free double-return weeks, the difference against the planner was '+interval(archive.summary.all.comparisons.planner)+
  ' credits/week. The two experts take the historical constant-penalty move on every closure-free board, so this result is inherited.</p>';
const actual='<p>On the released fleet’s own route there were '+count(d.eligible)+' disagreements. It switched '+count(d.switched)+' times and kept short '+count(d.deferred)+' times. In the paired decisions below both branches use the released policy after the disputed move. The full-week earnings comparisons let each policy choose its own positions throughout.</p>';
const lengths=[["Short · 1–3 half-days",fresh.durationGroups.short],["Long · 4–5 half-days",fresh.durationGroups.long]];
const long=fresh.durationGroups.long;
const subgroup='<p>On '+count(long.weeks)+' four- and five-half-day repair weeks the earnings difference was '+interval(long.comparisons.previous)+' credits/week against the previous detector and '+interval(long.comparisons.shortGate)+' against always short.</p>';
const controls=table("Release minus each reference",["Reference","Net credits/week [95% interval]","On-time pp [95% interval]"],
  Object.entries(names).filter(([key])=>key!=="rl").map(([key,label])=>[label,interval(comparison[key]),interval(comparison[key],true)]));
const allFits=table("Five fits on the same fresh weeks",["Seed","Selected rule","Credits vs previous","On-time pp vs previous","Credits vs short","Credits vs constant","Credits vs planner"],
  fresh.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),models.get(f.seed).settings.priorOnly?"Keep previous rule":"Allow added switches",interval(f.previous),interval(f.previous,true),interval(f.shortGate),interval(f.flatRisk),interval(f.planner)]));
const fitHits=recallGroups("Paired recall for each fit",detection.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),f]));
const longFits=table("Each fit on four- and five-half-day repairs",["Seed","Credits vs previous","Credits vs short","Credits vs long"],
  fresh.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),interval(f.longRepairs.previous),interval(f.longRepairs.shortGate),interval(f.longRepairs.longGate)]));
const summary=lead+'<h3 id="detection">What did the old detector miss?</h3>'+recallComparison+rediscovery+ranking+added+
  '<h3 id="benchmark">What did the switches earn?</h3>'+costImpact+comparisons+service+subgroup+archiveResult+
  section("Which extra choices paid off?",scope+effects+'<p>Totals above sum one-move interventions on the fixed short-trained path. The weekly benchmark uses separate full dispatch histories for each policy.</p>')+
  section("Recall by repair duration and freight schedule",recallGroups("Actual repair length",lengthDet)+recallGroups("Held-out schedules",familyDet)+
    '<p>Each interval pairs the two rules in '+count(pair.resamples)+' resamples of opportunity-bearing weeks within freight schedule. The overall interval used '+count(pair.validRecall)+' defined draws across '+count(pair.weeks)+' weeks.</p>')+
  section("How the policy handles previously skipped moves",modelNote+rule+netHead+ablation+calibration+forecastGroups+
    '<p>AUROC measures how often a profitable switch ranks above one that ties or loses. Brier score measures the squared distance between the forecast probability and the observed outcome. Positive reductions in that error favor the learned forecast. The new model’s constant forecast uses its training prevalence on skips, while the previous detector’s uses all its eligible calibration decisions.</p>')+
  section("Decisions on the deployed path",actual+decisions+eachLength)+
  section("Eight registered tests",registered)+
  section("Full weeks by repair length and schedule",defaultTable("Actual repair length",lengths)+defaultTable("Each completed repair length",Object.entries(fresh.byDuration).map(([n,g])=>[n+(n==="1"?" half-day":" half-days"),g]))+
    defaultTable("Fresh schedules",Object.entries(fresh.summary.byFamily).map(([family,g])=>[familyName(family),g])))+
  section("All dispatchers and benchmark banks",dispatcherTable(all,names)+controls+
    baselineTable("All benchmark banks",[["Development closures",validation],["Fresh closures",fresh],["Ordinary weeks",clean],["Original double-return",archive]].map(([k,b])=>[k,b.summary.all])))+
  section("Every independently trained fit",'<p>Training seed '+result.primarySeed+' was designated for publication before these weeks were scored.</p>'+allFits+fitHits+longFits);
const feature='<article class="latest-study" id="moverecall" aria-labelledby="moverecall-title"><div><h2 id="moverecall-title">Which profitable moves did the fleet miss?</h2><p>The new policy found '+
  count(now.tp)+' of '+count(now.profitable)+' profitable switches. The previous detector found '+count(before.tp)+' on the same boards. '+recallVerdict+'</p></div>'+
  '<figure class="load-distribution"><figcaption>On '+count(all.weeks)+' fresh weeks</figcaption>'+
  [["Change in recall",recallInterval(pair)+" pp"],["Earnings vs short",signed(comparison.shortGate.net,3)+" credits/week · "+verdict(comparison.shortGate)],["Earnings vs planner",signed(comparison.planner.net,3)+" credits/week · "+verdict(comparison.planner)]].map(([k,v])=>'<div class="load-bin"><strong>'+k+'</strong><span>'+v+'</span></div>').join("")+
  '</figure><nav aria-label="Finding missed moves"><a href="./moverecall.html">Choose a move →</a><a href="./moverecall.html#results">Read the results →</a><a href="./moverecall.html#detection">Compare recall →</a><a href="./moverecall.html#own-agent">Benchmark your agent →</a></nav></article>';
await writeSections("moverecall","moverecall.html",{play,results:summary});
await writeSections("moverecall","studies.html",{feature});
await writeSampleReport(data,result.suite,validation,"EvalSim move-recall RL",verifyMoveRecallReport);
