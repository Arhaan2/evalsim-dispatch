import {readFile} from "node:fs/promises";
import {verifyShortDefaultReport} from "../../docs/lib/shortdefault-benchmark.js";
import {familyName} from "../../docs/lib/overnight-view.js";
import {closurePlay} from "../closure/challenge.mjs";
import {verdict,defaultTable,primaryTable,allFitTables,decisionTables} from "../closure/switch-tables.mjs";
import {interval,section,baselineTable,registeredTests,dispatcherTable,writeSampleReport} from "../closure/repair-tables.mjs";
import {table,count,digits,signed,writeSections} from "../fleetweek/render-decisions.mjs";

const data=new URL("../../docs/data/shortdefault/",import.meta.url);
const result=JSON.parse(await readFile(new URL("results.json",data),"utf8"));
const checkpoints=await Promise.all(result.fitSeeds.map(seed=>readFile(new URL("fit-"+seed+".json",data),"utf8").then(JSON.parse)));
const models=new Map(checkpoints.map(m=>[m.seed,m]));
const released=models.get(result.primarySeed);
const {test:fresh, archive, clean, validation}=result.splits;
const {all}=fresh.summary, d=fresh.diagnostics;
const names={rl:"Short-default RL",shortGate:"Short-trained default",longGate:"Long-trained alternative",
  planner:"Rolling planner",flatRisk:"Constant penalty",flatGate:"Constant predictions"};
const {tests,registered}=registeredTests(all,archive,result.goals);
const short=all.comparisons.shortGate, base=all.comparisons.flatRisk, planner=all.comparisons.planner;

function shortFinding() {
  if (released.settings.shortOnly) return "The release followed the short-trained default on every board. Against that default it earned exactly zero additional credits.";
  if (!d.switched) return "The release kept the short-trained move at every disagreement. Both dispatchers finished every week with identical scores.";
  if (!short.wins && !short.losses) return "The release changed some moves and tied the short-trained default on every week’s earnings.";
  if (short.net95[0]>0) return "Switching beat always following the short-trained default on fresh earnings.";
  if (short.net95[1]<0) return "Always following the short-trained default earned more on fresh weeks.";
  return "The fresh weeks did not establish an earnings advantage from switching away from the short-trained default.";
}
const lengthRows=[["Short · 1–3 half-days",fresh.durationGroups.short],["Long · 4–5 half-days",fresh.durationGroups.long]];
const individual=Object.entries(fresh.byDuration).map(([n,g])=>[n+(n==="1"?" half-day":" half-days"),g]);
const primary=primaryTable(all.comparisons);
const switched=fresh.examples.length ? closurePlay(fresh.examples,{study:"shortdefault",
  sampleNote:"The evaluator forked all "+count(d.forked)+" disagreements on the release trajectory, playing both moves through Friday with the released agent on every later board. Each example is nearest its group’s median earnings difference among switches or deferrals that won, tied or lost."}) :
  "<p>The two frozen agents agreed on every decision in this bank. The fresh weeks produced no disagreement to replay.</p>";
const gates=table("Full-week scores against the six dispatchers",["Reference","Release credits/week [95% interval]","Release on-time pp [95% interval]"],
  Object.entries(names).filter(([key])=>key!=="rl").map(([k,n])=>[n,interval(all.comparisons[k]),interval(all.comparisons[k],true)]));
const {fits,longFits}=allFitTables(fresh,models,result.primarySeed);
const missed=d.outcomes.deferred;
const opportunities=d.deferred ? '<p>On the '+count(d.deferred)+' boards where the release kept short, taking the long-trained move would have earned more by Friday '+
  count(missed.losses)+' times. Keeping short earned more '+count(missed.wins)+' times. The other '+count(missed.ties)+' choices tied.</p>' : '';
const {decisions,eachLength}=decisionTables(d);
const goal=result.goals;
const challenges='<p>The release '+(goal.freshProfit?"met":"missed")+' the fresh earnings target against the rolling planner and '+
  (goal.freshFlatProfit?"met":"missed")+' it against the constant penalty. Its on-time service '+(goal.freshService?"met":"missed")+
  ' the planner target and '+(goal.freshFlatService?"met":"missed")+' the constant-penalty target. It met '+count(tests.filter(t=>t[3]).length)+' of the five registered tests.</p>';
const retention='<p>On the original double-return schedule the release earned '+interval(archive.summary.all.comparisons.planner)+
  ' credits/week relative to the planner. These are closure-free weeks. Both frozen agents and the release execute the historical constant-penalty policy on every board, so its earnings and service are inherited.</p>';
const long=fresh.durationGroups.long;
const lead='<p class="finding"><strong>'+shortFinding()+'</strong> On '+count(all.weeks)+' fresh weeks, the release switched on '+
  count(d.switched)+' of '+count(d.eligible)+' disagreements. On '+count(long.weeks)+' weeks with four- or five-half-day repairs, the difference against always following short was '+
  interval(long.comparisons.shortGate)+' credits/week.</p>';
const selection= released.settings.shortOnly ?
  '<p>Before opening the test bank, seed '+released.seed+' tried twelve switching rules across '+count(released.selection.weeks)+' selection weeks. None qualified. Each needed a positive earnings gain over short after subtracting one standard error and on-time service at least as high. The frozen policy always chose short. Its fitted predictions had no effect on dispatch, and any fresh baseline win belongs to the existing short-trained policy.</p>' :
  '<p>The release selected its switching rule on '+count(released.selection.weeks)+' training-selection weeks before opening the fresh test bank.</p>';
const switchingFits=fresh.fits.filter(f=>!models.get(f.seed).settings.shortOnly);
const otherFits=switchingFits.map(f=>'<p>Seed '+f.seed+' selected a switching rule. Against always short on all fresh weeks it earned '+
  interval(f.shortGate)+' credits/week with '+interval(f.shortGate,true)+' percentage points of on-time service. On four- and five-half-day repairs its earnings difference was '+
  interval(f.longRepairs.shortGate)+' credits/week.</p>').join("");
const scope='<p>Differences are release minus reference. Brackets give paired 95% intervals across simulated weeks. On-time service counts the share of ten due contracts served each week, measured in percentage points (pp).</p>';
const summary=lead+primary+selection+opportunities+scope+challenges+registered+retention+
  section("Did the repair length change the outcome?",'<p>Every schedule used the same duration mix. These groups use the completed repair length, which stayed hidden until the repair unfolded.</p>'+
    defaultTable("Short and long repairs",lengthRows)+defaultTable("Each completed repair length",individual))+
  section("When did switching pay off?",'<p>The short and long policies disagreed on '+count(d.eligible)+' of '+count(d.incidentBoards)+' boards with a warning or active repair. The new policy kept short '+
    count(d.deferred)+' times and took long '+count(d.switched)+' times. Its full dispatch sequence differed from short on '+count(d.weeksChanged)+' weeks. Each decision below compares its two continuations on the same freight. Full-week scores roll out each dispatcher from Monday.</p>'+decisions+eachLength)+
  section("Compare all six dispatchers",dispatcherTable(all,names)+gates+'<p>The constant-prediction control uses the same selection rule with the learned credit and service estimates fixed at calibration averages.</p>')+
  section("Fresh freight schedules",defaultTable("Four held-out schedules",Object.entries(fresh.summary.byFamily).map(([name,g])=>[familyName(name),g])))+
  section("Development, clean and double-return weeks",baselineTable("Four benchmark banks",[["Development closures",validation],["Fresh closures",fresh],["Ordinary weeks",clean],["Original double-return",archive]].map(([name,b])=>[name,b.summary.all])))+
  section("Five training fits",'<p>Seed 13 was designated for release before anyone scored these cases. Each row evaluates an independently fitted policy on the same fresh weeks.</p>'+otherFits+fits+longFits);
const feature='<article class="latest-study" id="shortdefault" aria-labelledby="shortdefault-title"><div><h2 id="shortdefault-title">When should the fleet switch?</h2><p>'+
  shortFinding()+' The release switched on '+count(d.switched)+' of '+count(d.eligible)+' disagreements.</p></div>'+
  '<figure class="load-distribution"><figcaption>Net credits/week on '+count(all.weeks)+' fresh weeks</figcaption>'+
  [["Against the short-trained default",short],["Against the planner",planner],["Against the constant penalty",base]].map(([name,c])=>
    '<div class="load-bin"><strong>'+name+'</strong><span>'+signed(c.net,3)+' · '+verdict(c)+'</span></div>').join("")+
  '</figure><nav aria-label="Short-trained default"><a href="./shortdefault.html">Choose a move →</a><a href="./shortdefault.html#results">Read the results →</a><a href="./shortdefault.html#own-agent">Benchmark your agent →</a></nav></article>';

await writeSections("shortdefault","shortdefault.html",{play:switched,results:summary});
await writeSections("shortdefault","studies.html",{feature});
await writeSampleReport(data,result.suite,validation,"EvalSim short-default RL",verifyShortDefaultReport);
