import {readFile} from "node:fs/promises";
import {verifyLongMoveReport} from "../../docs/lib/longmove-benchmark.js";
import {familyName} from "../../docs/lib/overnight-view.js";
import {closurePlay} from "../closure/challenge.mjs";
import {interval,section,baselineTable,registeredTests,dispatcherTable,writeSampleReport} from "../closure/repair-tables.mjs";
import {verdict,defaultTable,primaryTable,allFitTables,decisionTables} from "../closure/switch-tables.mjs";
import {table,count,digits,signed,writeSections} from "../fleetweek/render-decisions.mjs";

const data=new URL("../../docs/data/longmove/",import.meta.url);
const load=async file=>JSON.parse(await readFile(new URL(file+".json",data),"utf8"));
const result=await load("results");
const models=new Map(await Promise.all(result.fitSeeds.map(async seed=>[seed,await load("fit-"+seed)])));
const release=models.get(result.primarySeed);
const {test:fresh,validation,clean,archive}=result.splits, {goals}=result;
const all=fresh.summary.all, d=fresh.diagnostics, detector=fresh.detection.all;
const names={rl:"Long-move RL",shortGate:"Short-trained default",longGate:"Long-trained alternative",
  planner:"Rolling planner",flatRisk:"Constant penalty",flatGate:"Constant predictions"};
const {registered,tests}=registeredTests(all,archive,goals);
const {fits,longFits}=allFitTables(fresh,models,result.primarySeed);
const {decisions,eachLength}=decisionTables(d,{service:true});
const {shortGate:short,flatRisk:flat,planner}=all.comparisons;
const fraction=v=>v===null?"Undefined":digits(100*v,1)+"%";
const metric=v=>v===null?"Undefined":digits(v,3);
const bounds=range=>range===null?"Undefined":"["+range.map(v=>digits(v,3)).join(", ")+"]";

function observedResult() {
  if (release.settings.shortOnly) return "Training selected the short-trained default for every move. The release added zero credits over that dispatcher.";
  if (!d.switched) return "The release kept short at every fresh disagreement and earned the same as always following short.";
  if (short.net95[0]>0) return "The detector earned more than always following the short-trained dispatcher on fresh weeks.";
  if (short.net95[1]<0) return "Switching reduced fresh earnings compared with always following the short-trained dispatcher.";
  if (!short.wins && !short.losses) return "Switching left every fresh week’s earnings equal to those of the short-trained dispatcher.";
  return "The test left the earnings difference between switching and always following short unresolved.";
}
const counts=table("Would switching have earned more by Friday?",["Detector decision","Long earned more","Same earnings","Long earned less"],
  [["Switch to long",count(detector.tp),count(detector.switchedTies),count(detector.switchedCostly)],
   ["Keep short",count(detector.fn),count(detector.ties-detector.switchedTies),count(detector.costly-detector.switchedCostly)]],"opportunity-counts");
const detectionLead='<p>The short-trained dispatcher encountered '+count(detector.n)+' disagreements. Switching would have raised Friday earnings on '+
  count(detector.profitable)+' of them. The deployed rule identified '+count(detector.tp)+', missed '+count(detector.fn)+' and issued '+
  count(detector.fp)+' false alarms ('+count(detector.switchedTies)+' tied and '+count(detector.switchedCostly)+' cost credits).</p>';
function rankingFinding(b) {
  const r=b.uncertainty.auroc95;
  if (!r) return "This sample could not establish a ranking interval.";
  if (r[0]>.5) return "The probability scores ranked profitable moves above nonwins more often than chance on this sample.";
  if (r[1]<.5) return "The probability scores ranked profitable moves below nonwins more often than chance on this sample.";
  return "The ranking interval includes chance performance.";
}
function probabilityFinding(b) {
  const r=b.uncertainty.brierGain95;
  if (!r) return "";
  if (r[0]>0) return "The fitted probabilities had lower squared error than the constant forecast.";
  if (r[1]<0) return "The constant forecast had lower squared error than the fitted probabilities.";
  return "The difference in probability error is unresolved.";
}
const detectorStats=table("Scores on fixed short-policy decisions",["Measure","Released detector","Training-prevalence forecast"],
  [["Ranking (AUROC)",metric(detector.auroc),metric(detector.baseAuroc)],["Probability error (Brier)",metric(detector.brier),metric(detector.baseBrier)]]);
function detectionTable(title,entries) {
  return table(title,["Group","Decisions","Profitable","Found","False alarms","Missed","Precision","Recall","AUROC","Brier"],
    entries.map(([name,b])=>[name,count(b.n),count(b.profitable),count(b.tp),count(b.fp),count(b.fn),
      fraction(b.precision),fraction(b.recall),metric(b.auroc),metric(b.brier)]));
}
const u=detector.uncertainty;
const quality='<p>AUROC measures how often the raw detector ranks a profitable move above an unprofitable one, with half credit for a tied prediction. The Brier score measures how far each forecast probability was from what happened, giving larger errors more weight. Lower is better. The constant forecast uses the training calibration bank’s win rate ('+
  fraction(detector.baseRate)+'). Precision and recall measure switches that cleared every dispatch requirement. Precision is undefined when the rule never switches.</p>'+
  detectorStats+'<p>The paired 95% interval for AUROC was '+bounds(u.auroc95)+'. The reduction in Brier error against the constant forecast was '+metric(u.brierGain)+
  ' with interval '+bounds(u.brierGain95)+'. The evaluator resampled the '+count(u.weeks)+' opportunity-bearing weeks within schedule '+count(u.resamples)+' times, keeping decisions from one week together. '+rankingFinding(detector)+' '+probabilityFinding(detector)+'</p>';
function uncertaintyTable() {
  const groups=[["All fixed-path decisions",detector],["1–3 half-days",fresh.detection.durationGroups.short],["4–5 half-days",fresh.detection.durationGroups.long]];
  return table("Uncertainty in the probability estimates",["Repair group","Weeks with disagreements","AUROC [95% interval]","Defined AUROC draws","Brier error reduction [95% interval]","Defined Brier draws"],
    groups.map(([name,b])=>[name,count(b.uncertainty.weeks),metric(b.auroc)+" "+bounds(b.uncertainty.auroc95),count(b.uncertainty.validAuroc)+"/"+count(b.uncertainty.resamples),
      metric(b.uncertainty.brierGain)+" "+bounds(b.uncertainty.brierGain95),count(b.uncertainty.validBrier)+"/"+count(b.uncertainty.resamples)]));
}
const repairDetection=detectionTable("Detection by completed repair length",[
  ["1–3 half-days",fresh.detection.durationGroups.short],["4–5 half-days",fresh.detection.durationGroups.long]]);
const detectionFits=detectionTable("Five fitted detectors on identical opportunities",fresh.detection.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),f]));
const training='<p>The release trained on '+count(release.fitWeeks)+' new simulated weeks. Its '+count(release.fitExamples.rows)+' paired training decisions included '+count(release.fitExamples.wins)+
  ' where switching earned more. The fitting decisions include alternate starting truck positions and place extra weight on positions reached by the short-trained fleet. The 62 profitable choices from the earlier study stayed outside fitting, calibration, selection and testing.</p>';
const selection= release.settings.shortOnly ?
  '<p>After testing candidate settings on '+count(release.selection.weeks)+' separate selection weeks, the release kept the short-only rule. No switching rule cleared both the earnings hurdle over short (mean gain minus one standard error above zero) and the nonnegative mean service requirement. The fitted probabilities still give an auditable forecast at every disagreement.</p>' :
  '<p>The frozen rule switches only when the estimated win probability is at least '+fraction(release.settings.minWin)+' and expected earnings exceed '+digits(release.settings.hurdle,0)+
  ' additional credits.'+(release.settings.serviceCredit ? ' The service-adjusted score must also exceed the same hurdle, valuing one additional contract at '+digits(release.settings.serviceCredit,0)+' credits.' : ' Its selected rule placed no extra credit value on service. The weekly benchmark scores on-time deliveries separately.')+'</p>';
const pairedExplanation='<p>For this detection test, every model sees the same boards reached by the short-trained dispatcher. The evaluator takes one short or long move and then follows short on both branches through Friday. A profitable switch earns strictly more net credits. Ties count as false alarms when the model switches.</p>';
const actual='<p>On its own path, the released fleet encountered '+count(d.eligible)+' disagreements across '+count(d.incidentBoards)+' boards with a closure warning or active repair. It took long '+count(d.switched)+' times and kept short '+count(d.deferred)+' times. Its full action sequence differed from short on '+count(d.weeksChanged)+' weeks. For the paired decisions below, both branches follow the released agent after the first move.</p>';
const freshEarnings=[short,flat,planner].every(c=>c.net95[0]<=0 && c.net95[1]>=0) ?
  "The earnings comparisons against short, the constant penalty and the rolling planner were all inconclusive." : observedResult();
const lead='<p class="finding"><strong>The fleet found '+count(detector.tp)+' of '+count(detector.profitable)+' profitable moves on the short-trained dispatcher’s path.</strong> '+rankingFinding(detector)+' AUROC was '+
  metric(detector.auroc)+' '+bounds(detector.uncertainty.auroc95)+'. Across '+count(all.weeks)+' complete fresh weeks, switching earned '+signed(short.net*all.weeks,0)+
  ' total credits relative to always following short ('+interval(short)+' credits/week). '+freshEarnings+' The release met '+count(tests.filter(t=>t[3]).length)+' of seven registered tests.</p>';
const groupResult='<p>On '+count(fresh.durationGroups.long.weeks)+' weeks with four- or five-half-day repairs, the release earned '+interval(fresh.durationGroups.long.comparisons.shortGate)+' credits/week relative to the short-trained default.</p>';
const attribution=!d.weeksChanged ? '<p>On fresh closure weeks the release took the same moves as the short-trained dispatcher throughout. Any advantage over the other baselines came from that existing policy.</p>' :
  '<p>The rolling planner and constant penalty compare the entire fleet policies. The short-trained row isolates what the detector added beyond the existing dispatcher.</p>';
const service='<p>On-time service relative to the constant penalty was '+interval(flat,true)+' percentage points, and relative to the rolling planner it was '+
  interval(planner,true)+' points. The release '+(goals.freshFlatService?"met":"missed")+' the constant-penalty service target, '+(goals.freshService?"met":"missed")+' the planner target and '+
  (goals.freshShortService?"met":"missed")+' the short-trained service target.</p>';
const double='<p>On '+count(archive.summary.all.weeks)+' fresh draws of the original double-return schedule, the release earned '+
  interval(archive.summary.all.comparisons.planner)+' credits/week relative to the planner. On closure-free weeks both frozen agents already follow the historical constant-penalty dispatcher on every board. The release inherits its double-return result from that policy.</p>';
const lengths=[["Short · 1–3 half-days",fresh.durationGroups.short],["Long · 4–5 half-days",fresh.durationGroups.long]];
const eachDuration=Object.entries(fresh.byDuration).map(([n,g])=>[n+(n==="1"?" half-day":" half-days"),g]);
const controls=table("Release minus each control",["Control","Net credits/week [95% interval]","On-time pp [95% interval]"],
  ["shortGate","longGate","flatGate"].map(k=>[names[k],interval(all.comparisons[k]),interval(all.comparisons[k],true)]));
const summary=lead+primaryTable(all.comparisons)+groupResult+attribution+service+
  '<p>Rows show release minus reference. Brackets give paired 95% intervals. Service differences are in percentage points (pp).</p>'+
  '<h3 id="detection">Which profitable moves did the detector find?</h3>'+detectionLead+counts+pairedExplanation+
  section("Probability estimates and switching decisions",training+selection+quality+uncertaintyTable()+repairDetection+detectionFits)+
  section("Which moves paid off on the deployed path?",actual+decisions+eachLength)+
  section("Seven registered tests",registered+double)+
  section("Short repairs, long repairs and freight schedules",defaultTable("Repair-duration groups",lengths)+defaultTable("Each completed repair length",eachDuration)+
    defaultTable("Fresh freight schedules",Object.entries(fresh.summary.byFamily).map(([k,g])=>[familyName(k),g])))+
  section("Six dispatchers and four benchmark banks",dispatcherTable(all,names)+controls+
    baselineTable("All benchmark banks",[["Development closures",validation],["Fresh closures",fresh],["Ordinary weeks",clean],["Original double-return",archive]].map(([k,b])=>[k,b.summary.all])))+
  section("Five independently trained dispatchers",'<p>Seed '+result.primarySeed+' was fixed for release before evaluation. All five checkpoints face the same fresh weeks.</p>'+fits+longFits);
const play=fresh.examples.length ? closurePlay(fresh.examples,{study:"longmove",sampleNote:"These examples come from "+count(d.forked)+
  " paired decisions on the release agent’s own path. Each example is nearest the median earnings difference in its group, by whether the release switched or kept short and whether its choice won, lost or tied."}) :
  '<p>The frozen dispatchers agreed on every board in these weeks. There is no disagreement to replay.</p>';
const feature='<article class="latest-study" id="longmove" aria-labelledby="longmove-title"><div><h2 id="longmove-title">Can the fleet spot a profitable switch?</h2><p>'+
  'The decision rule found '+count(detector.tp)+' of '+count(detector.profitable)+' profitable switches and issued '+count(detector.fp)+' false alarms on the short-trained dispatcher’s path. '+freshEarnings+'</p></div>'+
  '<figure class="load-distribution"><figcaption>Net credits/week on '+count(all.weeks)+' fresh weeks</figcaption>'+
  [["Against short",short],["Against the rolling planner",planner],["Against the constant penalty",flat]].map(([k,v])=>'<div class="load-bin"><strong>'+k+'</strong><span>'+signed(v.net,3)+' · '+verdict(v)+'</span></div>').join("")+
  '</figure><nav aria-label="Profitable long moves"><a href="./longmove.html">Choose a move →</a><a href="./longmove.html#results">Read the results →</a><a href="./longmove.html#detection">Inspect the detector →</a><a href="./longmove.html#own-agent">Benchmark your agent →</a></nav></article>';
await writeSections("longmove","longmove.html",{play,results:summary});
await writeSections("longmove","studies.html",{feature});
await writeSampleReport(data,result.suite,validation,"EvalSim long-move RL",verifyLongMoveReport);
