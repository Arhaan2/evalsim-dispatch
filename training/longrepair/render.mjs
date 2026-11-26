import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {verifyLongRepairReport} from "../../docs/lib/longrepair-benchmark.js";
import {familyName} from "../../docs/lib/overnight-view.js";
import {closurePlay} from "../closure/challenge.mjs";
import {table, signed, count, digits, percentage, writeSections} from "../fleetweek/render-decisions.mjs";

const data = new URL("../../docs/data/longrepair/", import.meta.url);
const readJSON = async name => JSON.parse(await readFile(new URL(name+".json", data), "utf8"));
const result = await readJSON("results");
const {test:fresh, archive, clean, validation} = result.splits;
const {goals} = result;
const all = fresh.summary.all;
const diagnostics = fresh.diagnostics;
const labels = {rl:"Long-repair RL", planner:"Rolling planner", flatRisk:"Constant penalty",
  closure:"Earlier closure agent", flatGate:"Constant-score gate", shortGate:"Matched short-training agent"};

function interval(comparison, service=false) {
  const [point, bounds] = service ? [comparison.servicePP, comparison.service95] : [comparison.net, comparison.net95];
  return signed(point,3)+" ["+bounds.map(n=>signed(n,3)).join(", ")+"]";
}
function section(title, content) {
  return "<details><summary>"+title+"</summary>"+content+"</details>";
}
function earningsFinding() {
  if (goals.freshProfit && goals.freshFlatProfit) return "The agent beat both baselines on fresh earnings.";
  if (goals.freshProfit) return "The agent beat the planner on fresh earnings. The constant-penalty comparison missed its earnings target.";
  if (goals.freshFlatProfit) return "The agent beat the constant penalty on fresh earnings. The planner comparison missed its earnings target.";
  return "Fresh earnings against the rolling planner and constant penalty were both inconclusive.";
}

const tests = [
  ["Fresh earnings vs rolling planner",all.comparisons.planner,false,goals.freshProfit],
  ["Fresh earnings vs constant penalty",all.comparisons.flatRisk,false,goals.freshFlatProfit],
  ["Fresh on-time service vs rolling planner",all.comparisons.planner,true,goals.freshService],
  ["Fresh on-time service vs constant penalty",all.comparisons.flatRisk,true,goals.freshFlatService],
  ["Original double-return earnings vs planner",archive.summary.all.comparisons.planner,false,goals.doubleReturn],
];
const registered = table("Five registered tests",["Comparison","Agent difference [paired 95% interval]","Units","Test"],
  tests.map(([name,c,service,passed])=>[name,interval(c,service),service?"percentage points":"credits/week",passed?"Met":"Missed"]));
const serviceFinding = "The release "+(goals.freshFlatService?"met":"missed")+" the on-time service target against the constant penalty and "+
  (goals.freshService?"met":"missed")+" it against the rolling planner. On fresh double-return weeks, the inherited policy earned "+
  interval(archive.summary.all.comparisons.planner)+" credits/week relative to the planner.";
const absolutes = table("All six dispatchers on the fresh weeks",["Dispatcher","Net credits/week","Contracts on time","Empty miles/week"],
  Object.entries(labels).map(([key,name])=>{
    const p=all.policies[key];
    return [name,digits(p.net),percentage(p.onTime),digits(p.emptyMiles)];
  }));
function baselineTable(title, rows) {
  return table(title,["Weeks","Count","Credits vs planner","Credits vs constant penalty","On-time pp vs planner","On-time pp vs constant penalty"],
    rows.map(([name,g])=>[name,count(g.weeks),interval(g.comparisons.planner),interval(g.comparisons.flatRisk),
      interval(g.comparisons.planner,true),interval(g.comparisons.flatRisk,true)]));
}
const durations = baselineTable("Fresh weeks by completed repair duration",[
  ["Short · 1–3 half-days",fresh.durationGroups.short],["Long · 4–5 half-days",fresh.durationGroups.long],
]);
const byDuration = baselineTable("Each repair length",Object.entries(fresh.byDuration).map(([n,g])=>[n+(n==="1"?" half-day":" half-days"),g]));
const bySchedule = baselineTable("Each fresh freight schedule",Object.entries(fresh.summary.byFamily).map(([k,g])=>[familyName(k),g]));
const byBank = baselineTable("All benchmark banks",[["Development closures",validation],["Fresh closures",fresh],
  ["Ordinary weeks",clean],["Original double-return",archive]].map(([label,bank])=>[label,bank.summary.all]));
const controls = table("Release minus each secondary control",["Control","Credits/week [95% interval]","On-time pp [95% interval]"],
  ["closure","flatGate","shortGate"].map(k=>[labels[k],interval(all.comparisons[k]),interval(all.comparisons[k],true)]));
const fits = table("Five independently trained agents on the same fresh weeks",
  ["Training seed","Credits vs planner","Credits vs constant penalty","On-time pp vs planner","On-time pp vs constant penalty"],
  fresh.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),interval(f.planner),interval(f.flatRisk),interval(f.planner,true),interval(f.flatRisk,true)]));

const adoption = "<p>On the release agent’s path through the fresh weeks, the earlier closure agent and the constant penalty disagreed on "+
  count(diagnostics.eligible)+" of "+count(diagnostics.incidentBoards)+" boards with a warning or active repair. The release took the earlier agent’s move "+
  count(diagnostics.switched)+" times and stayed with the constant penalty "+count(diagnostics.deferred)+" times. Its dispatch sequence differed from the constant penalty on "+
  count(diagnostics.weeksChanged)+" weeks. Each dispatcher earned its weekly score from its own resulting truck positions.</p>";
const short = all.comparisons.shortGate;
const shortResult = short.net95[0]>0 ? "Fitting on longer repairs beat the matched short-training agent on fresh earnings." :
  short.net95[1]<0 ? "The matched short-training agent earned more on the fresh weeks." :
  "The comparison with the matched short-training agent did not establish a fresh earnings advantage for either fit.";
const shortVsConstant = fresh.versusFlatRisk.shortGate, shortVsPlanner = fresh.versusPlanner.shortGate;
const shortControl = '<p>Against the constant penalty, the matched short-training agent gained '+interval(shortVsConstant)+' credits/week and '+
  interval(shortVsConstant,true)+' percentage points of on-time service. Its earnings comparison with the rolling planner was '+
  interval(shortVsPlanner)+' credits/week.</p>';
const matchedByDuration = table("Long-repair training minus matched short training",["Repair duration","Credits/week [95% interval]","On-time pp [95% interval]"],
  [["Short · 1–3 half-days",fresh.durationGroups.short],["Long · 4–5 half-days",fresh.durationGroups.long]].map(([name,g])=>
    [name,interval(g.comparisons.shortGate),interval(g.comparisons.shortGate,true)]));
const previous = all.comparisons.closure;
const olderFinding = "On "+count(all.weeks)+" fresh weeks the new agent earned "+digits(Math.abs(previous.net),3)+
  (previous.net>=0?" more":" fewer")+" credits per week than the earlier closure agent.";
const byLength = Object.entries(fresh.byDuration).map(([d,g])=>[d,g,diagnostics.byDuration[d]]);
const decisions = table("Dispatches by completed repair length",["Half-days","Disagreements","Kept constant penalty","Took earlier agent’s move","Credits/week vs earlier agent [95% interval]"],
  byLength.map(([d,g,decision])=>[d,count(decision.eligible),count(decision.deferred),count(decision.switched),interval(g.comparisons.closure)]));
const summary = '<p class="finding"><strong>'+olderFinding+'</strong> On four- and five-half-day repairs the difference was '+interval(fresh.durationGroups.long.comparisons.closure)+' credits/week. '+earningsFinding()+' '+shortResult+' The release met '+
  count(tests.filter(t=>t[3]).length)+' of the five registered targets.</p>'+registered+'<p>'+serviceFinding+'</p>'+
  section("Four or five half-days vs shorter repairs",'<p>All four freight schedules drew from the same duration mix. These groups use the realized repair length, which the agent learned only as the week unfolded. Each interval is paired within its group.</p>'+durations+byDuration)+
  section("When did the agent stay with the constant penalty?",adoption+decisions)+
  section("Compare the six dispatchers",absolutes+controls+'<p>The earlier closure agent proposed moves. The constant-score gate tested whether conditioning on the current board helped. The matched short-training agent used the release seed, budget, calibration and selection weeks. Its fitting weeks contained only repairs lasting one to three half-days. '+shortResult+' The observed fresh difference was '+interval(short)+' credits/week.</p>'+shortControl+matchedByDuration)+
  section("Ordinary weeks and the original double-return result",byBank+'<p>On weeks without a closure, the released agent delegates every dispatch to the historical constant-penalty policy. The double-return comparison measures the earnings of that inherited behavior on fresh draws of the original schedule.</p>')+
  section("Four fresh freight schedules",bySchedule)+section("All five training fits",fits+'<p>Seed 13 was designated for release before evaluation. Intervals describe variation across weeks for each fixed fit.</p>');
const sampleNote = "The evaluator replayed both moves for "+count(diagnostics.forked)+" disagreements on the release trajectory. Each example is nearest its group’s median earnings difference, grouped by the agent’s choice and whether it paid off. Each pair starts at the same board and follows the released agent through Friday.";
const play = closurePlay(fresh.examples,{longRepair:true,sampleNote});
const panelMetric = (name,value) => '<div class="load-bin"><strong>'+name+'</strong><span>'+value+'</span></div>';
const feature = '<article class="latest-study" id="longrepair" aria-labelledby="longrepair-title"><div><h2 id="longrepair-title">When should the fleet stick with the constant penalty?</h2><p>'+olderFinding+' '+earningsFinding()+' '+shortResult+'</p></div><figure class="load-distribution"><figcaption>Long-repair RL on '+count(all.weeks)+' fresh weeks</figcaption>'+
  panelMetric("Against the planner",signed(all.comparisons.planner.net,3)+" credits/week")+
  panelMetric("Against the constant penalty",signed(all.comparisons.flatRisk.net,3)+" credits/week")+
  panelMetric("Contracts on time",percentage(all.policies.rl.onTime))+
  '</figure><nav aria-label="Longer depot repairs"><a href="./longrepair.html">Dispatch the trucks →</a><a href="./longrepair.html#results">Read the results →</a><a href="./longrepair.html#own-agent">Benchmark your agent →</a></nav></article>';

await writeSections("longrepair","longrepair.html",{play,results:summary});
await writeSections("longrepair","studies.html",{feature});

const bank = await readJSON("validation");
const sample = {suite:result.suite,version:1,split:"validation",policy:"EvalSim long-repair RL",
  cases:bank.cases.map(({family,seed,closure,rl})=>({family,seed,closure,...rl})),
  summary:{...validation.summary,durationGroups:validation.durationGroups,byDuration:validation.byDuration}};
const bytes = JSON.stringify(verifyLongRepairReport(sample,null,bank))+"\n";
const sampleFile = new URL("sample-report.json",data);
if (process.argv.includes("--check")) assert.equal(await readFile(sampleFile,"utf8"),bytes,"sample report differs from the verified release policy");
else await writeFile(sampleFile,bytes);
