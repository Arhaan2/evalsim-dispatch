import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {verifyClosureReport} from "../../docs/lib/closure-benchmark.js";
import {closurePlay} from "./challenge.mjs";
import {familyName} from "../../docs/lib/overnight-view.js";
import {table,signed,count,digits,percentage,writeSections} from "../fleetweek/render-decisions.mjs";

const result=JSON.parse(await readFile(new URL("../../docs/data/closure/results.json",import.meta.url),"utf8"));
const {test:fresh,archive,clean}=result.splits;
const {goals}=result;
const all=fresh.summary.all, diagnostics=fresh.diagnostics;
const format=(c,service=false)=>{
  const value=service ? c.servicePP : c.net, bounds=service ? c.service95 : c.net95;
  return signed(value,3)+" ["+bounds.map(n=>signed(n,3)).join(", ")+"]";
};
const measures=[
  ["Fresh earnings vs rolling planner",all.comparisons.planner,false,goals.freshProfit],
  ["Fresh earnings vs constant penalty",all.comparisons.flatRisk,false,goals.freshFlatProfit],
  ["Fresh on-time service vs rolling planner",all.comparisons.planner,true,goals.freshService],
  ["Fresh on-time service vs constant penalty",all.comparisons.flatRisk,true,goals.freshFlatService],
  ["Double-return earnings vs planner",archive.summary.all.comparisons.planner,false,goals.doubleReturn],
];
const registered=table("Five registered tests",["Comparison","Agent difference [paired 95% interval]","Units","Test"],
  measures.map(([name,c,service,passed])=>[name,format(c,service),service?"percentage points":"credits/week",passed?"Met":"Missed"]));
function earnings() {
  if(goals.freshProfit && goals.freshFlatProfit) return "RL earned more than both baselines on fresh closure weeks.";
  if(goals.freshProfit) return "RL beat the planner on fresh earnings. Its earnings test against the constant penalty missed.";
  if(goals.freshFlatProfit) return "RL beat the constant penalty on fresh earnings. Its earnings test against the planner missed.";
  if (all.comparisons.flatRisk.net95[1]<0 && all.comparisons.planner.net95[1]>=0) {
    return "The constant penalty earned "+digits(-all.comparisons.flatRisk.net,3)+" more credits per closure week than RL. The earnings comparison with the planner was inconclusive.";
  }
  return "RL missed both fresh closure earnings tests.";
}
function summaryTable(name,group) {
  const keys=["rl","planner","flatRisk"], labels=["Closure RL","Rolling planner","Constant penalty"];
  return table(name,["Dispatcher","Net credits/week","Contracts on time","Empty miles/week"],keys.map((key,i)=>{
    const p=group.policies[key];return [labels[i],digits(p.net),percentage(p.onTime),digits(p.emptyMiles)];
  }));
}
const schedules=table("Fresh closure schedules",["Schedule","Weeks","Credits vs planner","Credits vs constant penalty"],
  Object.entries(fresh.summary.byFamily).map(([f,g])=>[familyName(f),count(g.weeks),format(g.comparisons.planner),format(g.comparisons.flatRisk)]));
const fits=table("Five fits on the same fresh weeks",["Fit seed","Credits vs planner","On-time pp vs planner","Credits vs constant penalty","On-time pp vs constant penalty"],
  fresh.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":""),format(f.planner),format(f.planner,true),format(f.flatRisk),format(f.flatRisk,true)]));
const cross=table("Performance by bank",["Weeks","Count","Credits vs planner","Credits vs constant penalty","On-time pp vs planner","On-time pp vs constant penalty"],
  [["Development closures",result.splits.validation],["Fresh closures",fresh],["Ordinary weeks",clean],["Original double-return",archive]].map(([name,s])=>{
    const g=s.summary.all;return [name,count(g.weeks),format(g.comparisons.planner),format(g.comparisons.flatRisk),format(g.comparisons.planner,true),format(g.comparisons.flatRisk,true)];
  }));
const summary='<p class="finding"><strong>'+earnings()+'</strong> On '+count(all.weeks)+' fresh weeks, the fleet earned '+digits(all.policies.rl.net)+' net credits per week and delivered '+
  percentage(all.policies.rl.onTime)+' of contracts on time. '+measures.filter(r=>r[3]).length+' of the five registered tests passed.</p>'+
  registered+'<details><summary>Compare the three dispatchers</summary>'+summaryTable("Fresh closure weeks",all)+'</details>'+
  '<details><summary>How often did RL change the dispatch?</summary><p>Across '+count(diagnostics.incidentBoards)+' boards with a closure warning or active repair, the benchmark recorded '+
  count(diagnostics.eligible)+' eligible choices and '+count(diagnostics.switched)+' changes from the constant-penalty move on the release trajectory. The two dispatchers’ action sequences differed on '+count(diagnostics.weeksChanged)+' full weeks. Weekly comparisons use each dispatcher’s own truck positions.</p></details>'+
  '<details><summary>Ordinary weeks and double-return retention</summary>'+cross+'<p>On weeks without an incident, the closure agent follows the constant-penalty dispatcher on every round. Its double-return result measures retention through that existing policy.</p></details><details><summary>Four fresh schedules</summary>'+schedules+
  '</details><details><summary>All five training fits</summary>'+fits+'</details>';
const feature='<article class="latest-study" id="closure" aria-labelledby="closure-title"><div><h2 id="closure-title">Can you save the week after a depot closes?</h2><p>Two trucks face a repair notice with an uncertain reopening time. Dispatch the fleet, then follow both moves through Friday.</p></div>'+
  '<figure class="load-distribution"><figcaption>Fresh closure weeks</figcaption>'+
  ["rl","planner","flatRisk"].map((k,i)=>'<div class="load-bin"><strong>'+["Closure RL","Rolling planner","Constant penalty"][i]+'</strong><span>'+digits(all.policies[k].net)+' net credits/week</span></div>').join("")+
  '</figure><nav aria-label="Depot closure study"><a href="./closure.html">Play the closure →</a><a href="./closure.html#results">Read the results →</a><a href="./closure.html#own-agent">Make a scorecard →</a></nav></article>';
await writeSections("closure","closure.html",{play:closurePlay(fresh.examples),results:summary});
await writeSections("closure","studies.html",{feature});

const validation=JSON.parse(await readFile(new URL("../../docs/data/closure/validation.json",import.meta.url),"utf8"));
const sample={suite:result.suite,version:1,split:"validation",policy:"EvalSim closure RL",
  cases:validation.cases.map(({family,seed,closure,rl})=>({family,seed,closure,...rl})),summary:result.splits.validation.summary};
const sampleBytes=JSON.stringify(verifyClosureReport(sample,null,validation))+"\n";
const samplePath=new URL("../../docs/data/closure/sample-report.json",import.meta.url);
if(process.argv.includes("--check")) assert.equal(await readFile(samplePath,"utf8"),sampleBytes,"sample report differs from the verified public policy");
else await writeFile(samplePath,sampleBytes);
