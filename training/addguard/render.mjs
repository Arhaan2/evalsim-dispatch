import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verifyAddGuardReport} from "../../docs/lib/addguard-benchmark.js";
import {familyName} from "../../docs/lib/overnight-view.js";
import {count,digits,signed,table,writeSections} from "../fleetweek/render-decisions.mjs";
import {closurePlay} from "../closure/challenge.mjs";
import {interval,registeredTests,section,writeSampleReport} from "../closure/repair-tables.mjs";
import {verdict} from "../closure/switch-tables.mjs";

const data=new URL("../../docs/data/addguard/",import.meta.url);
const result=JSON.parse(await readFile(new URL("results.json",data),"utf8"));
const {validation,test:fresh,clean,archive}=result.splits;
const history=JSON.parse(await readFile(new URL("historical.json",data),"utf8")).fits.find(f=>f.seed===result.primarySeed);
const weekly=fresh.summary.all, comp=weekly.comparisons;
const {all,added}=fresh.detection;
const eligible=added.vsParent, recall=all.vsParent;
const {rl:guard,previous:parent,original:older}=all.outcomes;
const addedGuard=added.outcomes.rl, addedParent=added.outcomes.previous;
const {goals}=result;
const pct=n=>n==null?"Undefined":digits(100*n,1)+"%";
const rate=(point,bounds)=>point==null||!bounds?"Undefined":signed(100*point,2)+" ["+bounds.map(n=>signed(100*n,2)).join(", ")+"]";
const lossChange=g=>rate(g.lossReduction,g.loss95);
const recallChange=g=>rate(g.recallDifference,g.recall95);
const labels={rl:"Fit 73 with the learned guard",previous:"Frozen fit 73",original:"Move-recall RL",shortGate:"Always short",flatRisk:"Constant penalty",planner:"Rolling planner"};
const baselines=["shortGate","flatRisk","planner"];
const tests=[
  ["Losses avoided per 100 fit 73 additions",lossChange(eligible),"percentage points",goals.lossReduction?"Met":"Missed"],
  ["Profitable-move recall vs frozen fit 73",recallChange(recall),"percentage points",goals.recall?"Met":"Missed"]
];
const registered=registeredTests(weekly,archive,goals,null,tests);
const passes=registered.tests.filter(([, , ,pass])=>pass).length+Number(goals.recall)+Number(goals.lossReduction);
assert.equal(eligible.newLosses,addedGuard.losses);
assert.equal(eligible.oldLosses,addedParent.losses);
assert.equal(eligible.added.n,0,"A veto-only guard cannot add a switch to fit 73.");
assert.equal(recall.dropped.wins,eligible.dropped.wins);
const noChanged=eligible.dropped.n===0;
const contrast=noChanged?"The guard kept every move proposed by fit 73 on the reference route.":
  "The guard declined "+count(eligible.dropped.n)+" of the "+count(eligible.n)+" extra moves proposed by fit 73.";
const important='<p class="finding"><strong>'+contrast+'</strong> It avoided '+count(eligible.avoidedLosses)+' of '+count(eligible.oldLosses)+
  ' losing additions and gave up '+count(eligible.dropped.wins)+' of '+count(eligible.profitable)+' profitable additions.</p>';
const fixedRoute='<p>The earlier move-recall agent and fit 73 disagreed about these additions on the same truck route. For each one, the simulator tried short and long first, then used the short-trained dispatcher on both paths. A strict gain or loss is the difference in Friday credits.</p>';
const additions=table("Friday outcomes on fit 73’s extra moves",["Outcome","Frozen fit 73","With the guard"],
  [["Profitable additions kept",count(addedParent.wins),count(addedGuard.wins)],
    ["Ties kept",count(addedParent.ties),count(addedGuard.ties)],
    ["Losing additions kept",count(addedParent.losses),count(addedGuard.losses)]],"opportunity-counts");
assert.equal(history.kept.losses+history.vetoed.losses,6);
assert.equal(history.kept.wins+history.vetoed.wins,15);
assert.equal(history.kept.ties+history.vetoed.ties,3);
const retrospective='<p><strong>Replay of the original 24 additions.</strong> After model lock, the guard declined '+count(history.vetoed.losses)+
  ' of the six earlier losses and kept '+count(history.kept.wins)+' of the 15 earlier winners. The fresh-week tests above use separate weeks. <a href="./data/addguard/historical.json">Download the retrospective replays</a>.</p>';
const lossFinding=goals.lossReduction?"The paired interval supports a lower rate of losing additions.":
  "The paired interval did not establish fewer losing additions.";
const recallFinding=goals.recall?"The release met the zero-margin recall test against fit 73.":
  "The release missed the zero-margin recall test against fit 73.";
const savings='<p>On moves the guard declined, it saved '+count(Math.abs(eligible.dropped.losingCredits))+' credits on losses and gave up '+
  count(eligible.dropped.winningCredits)+' credits on winners. Its loss reduction was '+lossChange(eligible)+' per 100 fit 73 additions (paired 95% interval). '+lossFinding+'</p>';
const recallRows=[["Earlier move-recall agent",older],["Frozen fit 73",parent],["Fit 73 with the learned guard",guard]];
const counts=table("All profitable long moves on the same route",["Dispatcher","Caught / available","Recall"],recallRows.map(([name,x])=>
  [name,count(x.wins)+" / "+count(recall.profitable),pct(x.recall)]),"opportunity-counts");
const compared='<p>Across '+count(recall.n)+' disagreements, the change in recall versus frozen fit 73 was '+recallChange(recall)+
  ' percentage points. Against the earlier move-recall agent the difference was '+recallChange(all.vsMoveRecall)+
  ' points for the guard and '+recallChange(all.parentVsMoveRecall)+' for frozen fit 73. '+recallFinding+'</p>';
const economicRows=["previous",...baselines].map(key=>[labels[key],interval(comp[key])+' credits/week<br><strong>'+verdict(comp[key])+
  '</strong>',interval(comp[key],true)+" pp"]);
const earnings=table("Fresh earnings and on-time service",["Compared with","Earnings [95% interval]","Service [95% interval]"],economicRows,"default-comparisons");
const serviceWins=baselines.filter(key=>comp[key].servicePP>=0&&comp[key].service95[0]>=0).length;
const netWins=baselines.filter(key=>comp[key].net95[0]>0).length;
const economicIntro='<p>Each dispatcher controlled both trucks through '+count(weekly.weeks)+' complete weeks across eight new freight schedules. '+
  (fresh.diagnostics.changedActions===0?'The guard took the same action as frozen fit 73 on every round, so the full-week scores were inherited. ':'')+
  'The guard beat '+netWins+' of three baselines on earnings and matched or exceeded '+serviceWins+' of three on service. All ten contracts per week count.</p>';
const archiveComparison=archive.summary.all.comparisons.planner;
const identity=archive.diagnostics.constantActionDifferences===0;
const archiveCopy='<p>On '+count(archive.summary.all.weeks)+' new weeks from the original double-return schedule, the guard earned '+
  interval(archiveComparison)+' credits/week relative to the planner. '+(identity?'It chose the historical constant-penalty dispatcher’s action every round. The archive result is inherited.':
  'Its choices differed from the historical constant penalty on '+count(archive.diagnostics.constantActionDifferences)+' rounds.')+'</p>';
const method='<p>These are paired, two-sided 95% intervals from 2,000 resamples of weeks within freight schedules. The loss test requires a positive lower bound. The recall test allows zero loss of recall. Each earnings test requires a positive lower bound and each service test requires a nonnegative lower bound. '+
  'The intervals describe draws from these schedules.</p>';
const subgroup=(caption,groups)=>table(caption,["Group","Fit 73 additions","Losses avoided / available","Profitable additions given up / available","All-move recall change [95% interval], pp"],
  groups.map(([label,g])=>[label,count(g.added.vsParent.n),count(g.added.vsParent.avoidedLosses)+" / "+count(g.added.vsParent.oldLosses),
    count(g.added.vsParent.dropped.wins)+" / "+count(g.added.vsParent.profitable),recallChange(g.all.vsParent)]));
const summaries=(caption,groups)=>table(caption,["Group","Weeks","Earnings vs always short","Earnings vs constant penalty","Earnings vs planner","On-time pp vs planner"],
  groups.map(([label,g])=>[label,count(g.weeks),...baselines.map(key=>interval(g.comparisons[key])),interval(g.comparisons.planner,true)]));
const checkpoints=await Promise.all(result.fitSeeds.map(async seed=>JSON.parse(await readFile(new URL("fit-"+seed+".json",data),"utf8"))));
const training=table("How much evidence supported a veto?",["Fit","Eligible training examples","Natural calibration examples","Selection wins / ties / losses","Qualifying nonzero rules","Selected veto fraction"],
  checkpoints.map(f=>[f.seed,count(f.fitExamples.rows),count(f.calibrationExamples.rows),[f.selection.pool.wins,f.selection.pool.ties,f.selection.pool.losses].map(count).join(" / "),
    count(f.feasible),pct(f.settings.fraction)]));
const primary=checkpoints.find(f=>f.seed===result.primarySeed);
const independent=checkpoints.filter(f=>f.settings.fraction>0).length;
const nonzero=primary.selection.candidates.filter(c=>c.settings.fraction>0);
const forfeited=nonzero.filter(c=>c.winsForgone>0).length;
const winnerCost=forfeited===nonzero.length?" All "+nonzero.length+" would have discarded at least one profitable addition.":"";
const selectionFinding='<p>'+(!primary.settings.fraction?
  'On selection weeks, none of the release fit’s six veto rules met every requirement. Its predeclared fallback kept frozen fit 73’s decisions.'+winnerCost:
  'The release qualified to veto moves. Its selected cutpoint targeted the highest-risk '+pct(primary.settings.fraction)+' of additions on calibration weeks.')+
  ' Across the three continuations, '+count(independent)+' qualified to veto moves.</p>';
const selection=table("Release fit on its separate selection weeks",["Veto fraction","Losses avoided","Winners given up","Friday credit savings on vetoes","Full-route credits vs fit 73","Full-route on-time contracts vs fit 73"],
  primary.selection.candidates.map(c=>[pct(c.settings.fraction)+(c.settings.fraction===primary.settings.fraction?" · selected":""),count(c.lossesAvoided),count(c.winsForgone),
    count(c.savings),count(c.netParent),count(c.serviceParent)]));
const fits=table("Three continuations of frozen fit 73",["Fit","Parent losses avoided","Profitable additions given up","All-move recall change, pp","Credits/week vs fit 73","On-time pp vs fit 73"],
  fresh.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),count(f.added.vsParent.avoidedLosses),count(f.added.vsParent.dropped.wins),
    recallChange(f.all.vsParent),interval(f.previous),interval(f.previous,true)]));
const selectionExample=checkpoints.flatMap(f=>f.selection.candidates
  .filter(c=>c.settings.fraction>0 && c.lossesAvoided>0 && c.winsForgone>0 && c.netParent>0 && c.serviceParent>=0 && c.serviceShort>=0)
  .map(c=>({seed:f.seed,rule:c}))).sort((a,b)=>a.rule.winsForgone-b.rule.winsForgone||b.rule.netParent-a.rule.netParent)[0];
const exampleCopy=selectionExample?'<p>On selection weeks, fit '+selectionExample.seed+'’s '+pct(selectionExample.rule.settings.fraction)+
  ' veto rule avoided '+count(selectionExample.rule.lossesAvoided)+' losses and would have earned '+count(selectionExample.rule.netParent)+
  ' extra credits on its own route. It also gave up '+count(selectionExample.rule.winsForgone)+' profitable '+(selectionExample.rule.winsForgone===1?'move':'moves')+
  ', which ruled it out for release.</p>':'';
const forecast=table("Did the learned score identify losing moves?",["Fit","Losses / eligible moves","Loss AUROC [95% interval]","Brier error","Constant forecast error"],
  fresh.fits.map(f=>{
    const x=f.lossForecast, measured=n=>n==null?"Undefined":digits(n,3);
    return [f.seed,count(x.costly)+" / "+count(x.n),x.auroc95 ? measured(x.auroc)+" ["+x.auroc95.map(measured).join(", ")+"]":"Undefined",
      measured(x.brier),measured(x.baseBrier)];
  }));
const forecastKey='<p>AUROC measures how often the model ranks a losing addition above a non-loss. A random ranking averages 0.5. Lower Brier error means its loss probabilities were closer to the outcomes. The constant forecast uses the training-calibration loss rate.</p>';
const fitBaselines=table("Fresh-week earnings for every fit",["Fit","Credits vs always short","Credits vs constant penalty","Credits vs planner"],
  fresh.fits.map(f=>[f.seed,...baselines.map(key=>interval(f[key]))]));
const controls=table("Which fleets earned and served the most?",["Dispatcher","Net credits/week","On-time service","Empty miles/week"],
  Object.entries(labels).map(([key,label])=>{const p=weekly.policies[key];return [label,digits(p.net),digits(p.onTime,2)+"%",digits(p.emptyMiles)];}));
const releasePath='<p>On its own route the release reached '+count(fresh.diagnostics.eligibleBoards)+' additions and vetoed '+count(fresh.diagnostics.vetoedBoards)+
  '. Across '+count(fresh.diagnostics.weeksChanged)+' weeks its actions differed from frozen fit 73 on '+count(fresh.diagnostics.changedActions)+
  ' rounds. Later truck positions can change following a veto.</p>';
const play=fresh.examples.length?closurePlay(fresh.examples,{study:"addguard",sampleNote:
  "Each example is the first fresh addition in its decision and outcome group. Both choices see the same freight and use the short-trained dispatcher after this decision."}):
  '<p>The fixed short route encountered no extra moves from fit 73 on the fresh bank.</p>';
const fitMethod='<p>Each of three continuations learned from simulated short-versus-long Friday outcomes. Simulating six starting truck placements at each training board increased the supply of eligible examples. Calibration and rule selection used the truck positions actually reached on separate weeks. '+
  'A guard could decline only a new long move added by fit 73. On selection weeks it had to avoid a loss, preserve every profitable catch, earn more than its parent and preserve service against both the parent and always short. Seed 73 was designated for release before fitting.</p>';
const results=important+selectionFinding+'<h3 id="additions">Which added moves survived?</h3>'+fixedRoute+additions+savings+retrospective+
  '<h3 id="recall">Did fit 73 keep its recall?</h3>'+counts+compared+'<h3 id="benchmark">How did the fleet perform?</h3>'+economicIntro+earnings+archiveCopy+
  section("Check all nine registered tests",'<p>'+passes+' of nine criteria passed.</p>'+registered.registered+method)+
  section("Trace the decisions by repair length and freight schedule",subgroup("Repair duration",Object.entries(fresh.detection.byDuration).map(([n,g])=>[n+(n==="1"?" half-day":" half-days"),g]))+
    subgroup("Freight schedules",Object.entries(fresh.detection.byFamily).map(([k,g])=>[familyName(k),g])))+
  section("See how the guard was trained and compare all three fits",fitMethod+training+selection+exampleCopy+forecastKey+forecast+fits+fitBaselines)+
  section("Inspect complete fleet routes and all four banks",releasePath+controls+
    summaries("Benchmark banks",[["Development closures",validation],["Fresh closures",fresh],["Open depots",clean],["Original double-return",archive]].map(([name,split])=>[name,split.summary.all]))+
    summaries("Fresh schedules",Object.entries(fresh.summary.byFamily).map(([k,g])=>[familyName(k),g])));
const feature='<article class="latest-study" id="addguard" aria-labelledby="addguard-title"><div><h2 id="addguard-title">Which extra moves pay?</h2><p>'+
  contrast+' It caught '+count(guard.wins)+' of '+count(recall.profitable)+' profitable moves. On the same route the earlier move-recall agent caught '+count(older.wins)+'.</p></div>'+
  '<figure class="load-distribution"><figcaption>On '+count(weekly.weeks)+' fresh weeks</figcaption>'+
  [["Fit 73 losses avoided",count(eligible.avoidedLosses)+" / "+count(eligible.oldLosses)],["Profitable additions given up",count(eligible.dropped.wins)+" / "+count(eligible.profitable)],
    ["Earnings vs planner",signed(comp.planner.net,3)+" credits/week · "+verdict(comp.planner)]].map(([name,x])=>'<div class="load-bin"><strong>'+name+'</strong><span>'+x+'</span></div>').join("")+
  '</figure><nav aria-label="Fit 73’s extra moves"><a href="./addguard.html">Choose a dispatch →</a><a href="./addguard.html#results">Read the results →</a><a href="./addguard.html#recall">Compare recall →</a><a href="./addguard.html#tradeoff">Inspect the exploratory veto rule →</a><a href="./addguard.html#own-agent">Benchmark your agent →</a></nav></article>';
await writeSections("addguard","addguard.html",{play,results});
await writeSections("addguard","studies.html",{feature});
await writeSampleReport(data,result.suite,validation,"EvalSim fit 73 with the learned guard",verifyAddGuardReport);
