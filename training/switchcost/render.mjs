import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verifySwitchCostReport} from "../../docs/lib/switchcost-benchmark.js";
import {familyName,roundName,dispatchText} from "../../docs/lib/overnight-view.js";
import {traceClosure,incidentText} from "../../docs/lib/closure-view.js";
import {closurePlay} from "../closure/challenge.mjs";
import {interval,section,baselineTable,registeredTests,dispatcherTable,writeSampleReport} from "../closure/repair-tables.mjs";
import {verdict,defaultTable,primaryTable,decisionTables} from "../closure/switch-tables.mjs";
import {table,count,digits,signed,writeSections} from "../fleetweek/render-decisions.mjs";

const data=new URL("../../docs/data/switchcost/",import.meta.url);
const load=async name=>JSON.parse(await readFile(new URL(name+".json",data),"utf8"));
const result=await load("results");
const models=new Map(await Promise.all(result.fitSeeds.map(async seed=>[seed,await load("fit-"+seed)])));
const release=models.get(result.primarySeed);
const {test:fresh,validation,clean,archive}=result.splits;
const all=fresh.summary.all, comp=all.comparisons;
const detection=fresh.detection, now=detection.all, before=now.previous, pair=now.vsPrevious;
const d=fresh.diagnostics;
const labels={rl:"Switch-cost RL",previous:"Move-recall RL",original:"Original long-move detector",
  shortGate:"Short-trained default",longGate:"Long-trained alternative",planner:"Rolling planner",flatRisk:"Constant penalty",flatGate:"Constant predictions"};
const percent=n=>n==null?"Undefined":digits(100*n,1)+"%";
function pairedRate(n,ci) {
  if(n==null || !ci) return "Undefined";
  return signed(n*100,2)+" ["+ci.map(p=>signed(p*100,2)).join(", ")+"]";
}
const costInterval=c=>pairedRate(c.lossReduction,c.loss95);
const recallInterval=c=>pairedRate(c.recallDifference,c.recall95);
const costVerdict=result.goals.lossReduction?"Costly switches fell.":pair.oldLosses===pair.newLosses?
  "Both policies made the same number of costly switches.":"The study did not establish a lower rate of costly switches.";
const recallVerdict=result.goals.recall?"The agent met the zero-margin recall test.":"The agent missed the zero-margin recall test.";
const detectionTests=[
  ["Reduction in costly switches vs move-recall RL",costInterval(pair),"percentage points",result.goals.lossReduction?"Met":"Missed"],
  ["Profitable-move recall vs move-recall RL",recallInterval(pair),"percentage points",result.goals.recall?"Met":"Missed"]
];
const {registered,tests}=registeredTests(all,archive,result.goals,null,detectionTests);
const passed=tests.filter(t=>t[3]).length+Number(result.goals.lossReduction)+Number(result.goals.recall);
assert.equal(pair.oldLosses-pair.newLosses,pair.avoidedLosses-pair.addedLosses);
assert.equal(now.tp-before.tp,pair.added.wins-pair.dropped.wins);
const secondary=result.fitSeeds.filter(seed=>seed!==result.primarySeed && (models.get(seed).settings.vetoFraction || models.get(seed).settings.addFraction));
function caseDetail(week,board,seed,switched){
  const paths=[week.shortGate,board.alternative].map(p=>{
    const trace=traceClosure(week,p.actions);
    assert.deepEqual(trace.ledger,p.ledger);
    return trace;
  });
  const epoch=board.epoch, base=paths[0].trace[epoch], alternative=paths[1].trace[epoch];
  assert.equal(base.action.id,board.shortId);
  assert.equal(alternative.action.id,board.longId);
  const decision=switched?"added a long move":"declined a long move";
  const heading='Week '+week.seed+' · '+roundName(epoch)+' · fit '+seed+' '+decision;
  const frame='<p>'+familyName(week.family)+' · '+incidentText(base.observation.incident)+'. Short recommended '+dispatchText(base)+
    '. Long recommended '+dispatchText(alternative)+'. Both branches followed short after this decision.</p>';
  const ledger=table("Friday outcomes from this decision",["First choice","Net credits","On-time contracts","Empty miles"],
    paths.map((p,i)=>[i?"Long":"Short",count(p.ledger.net),count(p.ledger.served)+" / 10",count(p.ledger.emptyMiles)]),"opportunity-counts");
  const log=table("Fixed-path replay through Friday",["Round","Depot update","Short first","Long first"],
    paths[0].trace.map((r,i)=>[roundName(i),incidentText(r.observation.incident),...paths.map(p=>dispatchText(p.trace[i]))]),"journey");
  return section(heading,frame+ledger+section("Replay all ten rounds",log));
}
async function readFreshCases(){
  const {cases}=await load("test"), index=result.fitSeeds.indexOf(result.primarySeed);
  const previous={losses:0,credits:0}, current={losses:0,credits:0};
  const examples=new Map(secondary.map(seed=>[seed,{}]));
  for(const week of cases) for(const board of week.opportunities){
    for(const seed of secondary){
      const pick=board.predictions[result.fitSeeds.indexOf(seed)].switched;
      if(pick===board.previous.switched) continue;
      const key=pick?"added":"vetoed", group=examples.get(seed);
      if(!group[key]) group[key]=caseDetail(week,board,seed,pick);
    }
    const loss=week.shortGate.ledger.net-board.alternative.ledger.net;
    if(loss<=0) continue;
    if(board.previous.switched){previous.losses++;previous.credits+=loss;}
    if(board.predictions[index].switched){current.losses++;current.credits+=loss;}
  }
  assert.equal(previous.losses,pair.oldLosses);
  assert.equal(current.losses,pair.newLosses);
  const mean=s=>s.losses?digits(s.credits/s.losses,1):"No loss";
  return {old:mean(previous),current:mean(current),oldCredits:previous.credits,newCredits:current.credits,examples};
}
const severity=await readFreshCases();
const lead='<p class="finding"><strong>'+costVerdict+'</strong> On '+count(pair.n)+' fresh decisions, move-recall RL took '+count(pair.oldLosses)+' losing switches and the release took '+count(pair.newLosses)+'. '+recallVerdict+'</p>';
const matched=table("Both policies faced the same choices",["Measure","Move-recall RL","Switch-cost RL"],[
  ["Long moves chosen",count(before.switched),count(now.switched)],["Losses among all disagreements",count(pair.oldLosses)+" / "+count(pair.n),count(pair.newLosses)+" / "+count(pair.n)],
  ["Profitable moves caught",count(before.tp)+" / "+count(pair.profitable),count(now.tp)+" / "+count(pair.profitable)],
  ["Share of profitable moves caught (recall)",percent(before.recall),percent(now.recall)],
  ["Share of switches that earned more (precision)",percent(before.precision),percent(now.precision)],
  ["Switches that tied",count(before.switchedTies),count(now.switchedTies)],["Total credits lost on losing switches",count(severity.oldCredits),count(severity.newCredits)],
  ["Average credits per losing switch",severity.old,severity.current]],"opportunity-counts");
const differences='<p>The release avoided '+count(pair.avoidedLosses)+' prior losses and added '+count(pair.addedLosses)+' new ones. The reduction in losses per 100 disagreements was '+costInterval(pair)+
  '. Of the previous policy’s profitable switches, '+count(pair.bothCaught)+' were kept and '+count(pair.dropped.wins)+' were dropped. New choices caught '+count(pair.added.wins)+' other profitable moves.</p>'+
  '<p>The recall difference was '+recallInterval(pair)+' percentage points. Retention requires the estimated change and the lower 95% bound to reach zero or higher. Loss reduction requires a strictly positive lower bound.</p>';
const changed=table("Changes to the move-recall decisions",["On the short-trained path","Decisions","Long earned more","Tied","Long earned less","Winning credits","Losing credits","Long minus short credits","Extra contracts served"],
  [["Took long where prior chose short",pair.added],["Kept short where prior took long",pair.dropped]].map(([label,o])=>
    [label,count(o.n),count(o.wins),count(o.ties),count(o.costly),signed(o.winningCredits,0),signed(o.losingCredits,0),signed(o.credits,0),signed(o.contracts,0)]));
const changeImpact='<p>In the newly selected group the long moves changed earnings by '+signed(pair.added.credits,0)+' credits. Declining the dropped group changed earnings by '+signed(-pair.dropped.credits||0,0)+
  ' credits. Across these one-decision comparisons the net change was '+signed(pair.added.credits-pair.dropped.credits,0)+' credits. After each forced choice, both trucks followed the short-trained dispatcher through Friday.</p>';
const rescueSubset='<p>Of the predecessor’s '+count(pair.oldLosses)+' losing switches in this fresh evaluation, '+count(detection.byPreviousChoice.rescued.vsPrevious.oldLosses)+
  ' came from its own rescues and '+count(detection.byPreviousChoice.original.vsPrevious.oldLosses)+' were inherited from the original long-move detector. The '+count(detection.byPreviousChoice.rescued.vsPrevious.oldLosses)+' fresh rescue losses come from newly generated weeks. The earlier study supplied the question only.</p>';
const method='<p>The evaluator follows the short-trained dispatcher and records every board where its recommended move differs from the long-trained expert’s. Both policies score that same list. A loss is any strict decrease in Friday net credits from taking long. Ties do not count as losses or wins. Loss rates use all disagreements, and recall uses the subset where long earned more. The motivating 51 losses came from the earlier study and were excluded from fit and test data.</p>';
function groupTable(title,groups){
  return table(title,["Group","Decisions","Avoided losses","New losses","Wins kept","Wins lost","New wins","Loss reduction [paired 95%], pp","Recall difference [paired 95%], pp"],
    groups.map(([label,g])=>{const p=g.vsPrevious;
      return [label,count(p.n),count(p.avoidedLosses),count(p.addedLosses),count(p.bothCaught),count(p.dropped.wins),count(p.added.wins),costInterval(p),recallInterval(p)];}));
}
const opportunities=groupTable("Decisions grouped by the predecessors’ choices",[
  ["Switches added by move-recall RL",detection.byPreviousChoice.rescued],["Switches inherited from the original detector",detection.byPreviousChoice.original],
  ["Previously kept short",detection.byPreviousChoice.skipped]]);
const scope='<p>Paired intervals use '+count(pair.resamples)+' resamples of whole opportunity-bearing weeks within freight schedule. The overall comparison includes '+count(pair.weeks)+
  ' such weeks. '+count(pair.validLoss)+' resamples defined the loss rate and '+count(pair.validRecall)+' defined recall. Repair length is revealed after dispatch.</p>';
const {settings}=release;
const fallback=settings.vetoFraction===0 && settings.addFraction===0;
function policyDescription(model){
  const v=model.settings.vetoFraction,a=model.settings.addFraction;
  if(!v && !a) return "Keep move-recall rule";
  return (v?"Veto bottom "+percent(v):"Keep previous rescues")+(a?" · add top "+percent(a):" · no additions");
}
const actionRules='<p>The release protects the original long-move detector’s long choices. On boards where move-recall RL previously added a switch, the new policy can veto low-scoring moves. It can also take high-scoring long moves where both previous policies chose short. '+(settings.vetoFraction?
  'The veto cutoff came from the bottom '+percent(settings.vetoFraction)+' of scores on the calibration rescues. ':'Training selected no vetoes. ')+(settings.addFraction?
  'The addition cutoff came from the top '+percent(settings.addFraction)+' of scores on previously skipped calibration boards.':'Training selected no added switches.')+'</p>'+
  '<p>Using simulated Friday outcomes, the model learns win probability, loss probability, upside, downside and service. Its decision score starts with predicted net credits, adds 12 per extra on-time contract and six times the win probability, and subtracts 12 times the loss probability. Percentiles set score thresholds on calibration weeks. Fresh weeks may have a different share of switches.</p>';
const training='<p>The five regularized forecasts used '+count(release.fitExamples.rows)+' editable decisions from '+count(release.fitWeeks)+' simulated fitting weeks. Another '+count(release.calibrationExamples.rows)+
  ' decisions calibrated their predictions, and '+count(release.selection.weeks)+' separate weeks selected the operating rule. Of 25 settings, '+count(release.selection.feasible)+
  ' met all training requirements for losses avoided, profitable moves kept, credits and service.</p>';
const scalar=n=>n==null?"Undefined":digits(n,4);
function estimate(n,bounds){return bounds?scalar(n)+' ['+bounds.map(scalar).join(', ')+']':scalar(n);}
const lossForecast=table("Loss forecasts on decisions the release can change",["Opportunity group","Eligible","Actual losses","Ranking (AUROC) [95% interval]","Probability error (Brier)","Error reduction vs constant [95% interval]"],
  [["All editable choices",now.loss],["Move-recall rescues",detection.byPreviousChoice.rescued.loss],["Previously kept short",detection.byPreviousChoice.skipped.loss]].map(([label,g])=>
    [label,count(g.n),count(g.costly),estimate(g.auroc,g.uncertainty.auroc95),scalar(g.brier),estimate(g.uncertainty.brierGain,g.uncertainty.brierGain95)]));
const flatControl='<p>Replacing the learned estimates with calibration averages changed the weekly comparison by '+interval(comp.flatGate)+' credits and '+interval(comp.flatGate,true)+
  ' on-time percentage points, measured as the release minus that constant-forecast control. Ranking measures how often a losing switch gets a higher risk estimate than a tie or win. Brier score measures probability error. Positive error reduction favors the learned forecast.</p>';
const inheritance=fallback?'<p><strong>Training selected the previous move-recall rule.</strong> None of the release fit’s candidate changes cleared all selection requirements. '+count(result.fitSeeds.length-secondary.length)+
  ' of five fits kept the prior policy. The release inherited its predecessor’s results on every fresh week.</p>':'';
const measuredLoss=now.loss;
const forecastFinding='<p>Across '+count(measuredLoss.n)+' editable decisions the release model’s loss forecast ranked losses ahead of ties or wins with AUROC '+
  estimate(measuredLoss.auroc,measuredLoss.uncertainty.auroc95)+'. Its reduction in probability error against the constant forecast was '+
  estimate(measuredLoss.uncertainty.brierGain,measuredLoss.uncertainty.brierGain95)+'. '+(fallback?'The selected decision rule used none of these new predictions.':'')+'</p>';
function secondaryStudy(seed){
  const g=detection.fits.find(f=>f.seed===seed), p=g.vsPrevious, f=fresh.fits.find(fit=>fit.seed===seed);
  const cases=severity.examples.get(seed);
  const lossMet=p.loss95 && p.loss95[0]>0, recallMet=p.recall95 && p.recall95[0]>=0 && p.recallDifference>=0;
  const testsMet=[lossMet,recallMet].filter(Boolean).length;
  const serviceMet=["shortGate","flatRisk","planner"].filter(k=>f[k].servicePP>=0 && f[k].service95[0]>=0).length;
  const fitReport='<p>Training fit '+seed+' selected a rule that could change the prior’s choices. Losing switches went from '+count(p.oldLosses)+' to '+count(p.newLosses)+
    ' and profitable switches caught went from '+count(g.previous.tp)+' to '+count(g.tp)+' of '+count(p.profitable)+'. The fit met '+count(testsMet)+' of the two decision tests. It avoided '+count(p.avoidedLosses)+' losses and introduced '+count(p.addedLosses)+
    '. It retained '+count(p.bothCaught)+' profitable switches, gave up '+count(p.dropped.wins)+' and found '+count(p.added.wins)+' others. Its loss reduction was '+costInterval(p)+
    ' percentage points, and its recall change was '+recallInterval(p)+' percentage points.</p>'+
    '<p>Vetoing the dropped switches saved '+count(-p.dropped.losingCredits||0)+' credits on losses and gave up '+count(p.dropped.winningCredits)+' credits on wins. Added moves earned '+
    count(p.added.winningCredits)+' credits from wins and cost '+count(-p.added.losingCredits||0)+' credits on losses. On the independently played full weeks, the difference was '+
    signed(f.previous.net*all.weeks,0)+' total credits and '+signed(f.previous.servicePP*all.weeks/10,0)+' on-time contracts against move-recall RL. That corresponds to '+
    interval(f.previous)+' credits/week and '+interval(f.previous,true)+' percentage points of service. The fit cleared '+count(serviceMet)+' of the three baseline service targets.</p>';
  const compare=table("Fit "+seed+" on complete fresh weeks",["Reference","Credits/week [95% interval]","On-time pp [95% interval]"],
    ["shortGate","flatRisk","planner"].map(k=>[labels[k],interval(f[k]),interval(f[k],true)]),"opportunity-counts");
  const replayNote='<p>The examples are the first veto and the first added switch in published bank order, when observed. Their later rounds use the short-trained policy on both paths.</p>';
  const command='<pre tabindex="0" aria-label="Reproduce fit '+seed+'"><code>node tools/reserve.mjs --suite switchcost --split test --policy fit-'+seed+' --out fit-'+seed+'.json</code></pre><p><a href="#own-agent">Verify the report and make a scorecard</a></p>';
  return '<h3 id="fit-'+seed+'">Secondary fit '+seed+'</h3>'+fitReport+section("Inspect fit "+seed+" decisions and reproduce its results",compare+replayNote+(cases.vetoed||'')+(cases.added||'')+command);
}
const nWins=[result.goals.freshProfit,result.goals.freshFlatProfit,result.goals.freshShortProfit].filter(Boolean).length;
const economics='<p>Over '+count(all.weeks)+' complete weeks, the release earned '+signed(comp.previous.net*all.weeks,0)+' total credits relative to move-recall RL. The difference was '+interval(comp.previous)+
  ' credits/week. It met '+nWins+' of three earnings targets and '+passed+' of nine registered tests.</p>'+primaryTable(comp,labels.previous);
const service='<p>The on-time service target was '+(result.goals.freshShortService?"met":"missed")+' against always short, '+(result.goals.freshFlatService?"met":"missed")+
  ' against the constant penalty and '+(result.goals.freshService?"met":"missed")+' against the planner. Service differences are percentage points of the ten contracts due each week. Brackets show paired 95% intervals.</p>';
const long=fresh.durationGroups.long;
const cohorts='<p>On '+count(long.weeks)+' four- and five-half-day closures the earnings difference was '+interval(long.comparisons.previous)+' credits/week against move-recall RL and '+interval(long.comparisons.shortGate)+
  ' against always short. On '+count(archive.summary.all.weeks)+' fresh closure-free double-return weeks the release earned '+interval(archive.summary.all.comparisons.planner)+' credits/week over the planner. Both experts follow the historical constant penalty on open weeks. The archive result is inherited.</p>';
const {decisions,eachLength}=decisionTables(d,{service:true});
const actual='<p>The released fleet reached '+count(d.eligible)+' disagreements in its own weeks and took long on '+count(d.switched)+
  '. These paired replays use the released policy on both branches after the disputed move. In the weekly benchmark, each policy independently chooses every move.</p>';
const sampleNote='The evaluator paired both actions on '+count(d.forked)+' disagreements reached by the release. Each example is nearest the median Friday credit change in its decision and outcome group. Both branches use the release for the remaining rounds.';
const play=fresh.examples.length?closurePlay(fresh.examples,{study:"switchcost",sampleNote}):'<p>The two experts agreed on every board reached by the release; there are no disputed moves in these replays.</p>';
const controls=table("Release minus each reference",["Reference","Net credits/week [95% interval]","On-time pp [95% interval]"],
  Object.entries(labels).filter(([k])=>k!=="rl").map(([k,label])=>[label,interval(comp[k]),interval(comp[k],true)]));
const fits=table("Five fits on the same fresh weeks",["Fit seed","Training-selected rule","Credits vs move-recall RL","On-time pp vs move-recall RL","Credits vs short","Credits vs constant","Credits vs planner"],
  fresh.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),policyDescription(models.get(f.seed)),interval(f.previous),interval(f.previous,true),interval(f.shortGate),interval(f.flatRisk),interval(f.planner)]));
const longFits=table("Five fits on four- and five-half-day repairs",["Fit seed","Credits vs move-recall RL","Credits vs short","Credits vs long"],
  fresh.fits.map(f=>[f.seed,interval(f.longRepairs.previous),interval(f.longRepairs.shortGate),interval(f.longRepairs.longGate)]));
const repairLength=[["1–3 half-days",detection.durationGroups.short],["4–5 half-days",detection.durationGroups.long]];
const names=items=>Object.entries(items).map(([name,item])=>[familyName(name),item]);
const results=lead+inheritance+'<h3 id="detection">Which switches changed?</h3>'+matched+differences+
  '<h3 id="benchmark">What did the fleet earn?</h3>'+economics+service+cohorts+secondary.map(secondaryStudy).join('')+
  section("Credits won and lost on the changed choices",changed+changeImpact+opportunities+rescueSubset+method)+
  section("Checking all nine registered tests",registered+scope)+
  section("How the agent decides whether to switch",actionRules+training+forecastFinding+lossForecast+flatControl)+
  section("Decisions by repair length and freight schedule",groupTable("Actual repair length",repairLength)+groupTable("Fresh freight schedules",names(detection.byFamily)))+
  section("Decisions on the released fleet’s own path",actual+decisions+eachLength)+
  section("Full-week results by closure length and schedule",defaultTable("Each completed repair length",Object.entries(fresh.byDuration).map(([n,g])=>[n+(n==="1"?" half-day":" half-days"),g]))+defaultTable("Fresh schedules",names(fresh.summary.byFamily)))+
  section("Reference policies and benchmark banks",dispatcherTable(all,labels)+controls+baselineTable("All benchmark banks",[["Development closures",validation],["Fresh closures",fresh],["Ordinary weeks",clean],["Original double-return",archive]].map(([label,b])=>[label,b.summary.all])))+
  section("Every independently trained fit",'<p>Seed '+result.primarySeed+' was designated for publication before fresh evaluation.</p>'+fits+groupTable("Fixed-path decisions for all five fits",detection.fits.map(f=>[f.seed,f]))+longFits);
const feature='<article class="latest-study" id="switchcost" aria-labelledby="switchcost-title"><div><h2 id="switchcost-title">Which switches should the fleet skip?</h2><p>'+costVerdict+
  ' Move-recall RL made '+count(pair.oldLosses)+' losing switches and the new policy made '+count(pair.newLosses)+' on identical decisions. '+recallVerdict+'</p></div>'+
  '<figure class="load-distribution"><figcaption>On '+count(all.weeks)+' fresh weeks</figcaption>'+
  [["Losses avoided / added",count(pair.avoidedLosses)+" / "+count(pair.addedLosses)],["Change in recall",recallInterval(pair)+" pp"],["Earnings vs planner",signed(comp.planner.net,3)+" credits/week · "+verdict(comp.planner)]].map(([k,v])=>'<div class="load-bin"><strong>'+k+'</strong><span>'+v+'</span></div>').join("")+
  '</figure><nav aria-label="Cost of switching"><a href="./switchcost.html">Choose a move →</a><a href="./switchcost.html#detection">Compare the switches →</a><a href="./switchcost.html#results">Read the results →</a>'+
  secondary.map(seed=>'<a href="./switchcost.html#fit-'+seed+'">Inspect fit '+seed+' →</a>').join('')+'<a href="./switchcost.html#own-agent">Benchmark your agent →</a></nav></article>';
await writeSections("switchcost","switchcost.html",{play,results});
await writeSections("switchcost","studies.html",{feature});
await writeSampleReport(data,result.suite,validation,"EvalSim switch-cost RL",verifySwitchCostReport);
