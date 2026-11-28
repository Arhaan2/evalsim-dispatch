import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {familyName,roundName} from "../../docs/lib/overnight-view.js";
import {verifyFridayGuardReport} from "../../docs/lib/fridayguard-benchmark.js";
import {count,signed,table,writeSections} from "../fleetweek/render-decisions.mjs";
import {section,writeSampleReport} from "../closure/repair-tables.mjs";
import {fitReplays} from "./replay.mjs";

const data=new URL("../../docs/data/fridayguard/",import.meta.url);
const read=async file=>JSON.parse(await readFile(new URL(file,data),"utf8"));
const [results,history,opportunity,context]=await Promise.all([read("results.json"),read("historical.json"),read("opportunities.json"),read("baselines.json")]);
const models=await Promise.all(results.fitSeeds.map(seed=>read("fit-"+seed+".json")));
const {test:fresh,validation,clean,archive}=results.splits;
const all=fresh.summary.all, primary=fresh.fits.find(f=>f.seed===results.primarySeed), goals=all.goals;
assert(primary && history.baseline.misses===39 && history.baseline.saves===35);
const names={previous:"Frozen fit 101",fit211:"Frozen fit 211",frozen73:"Original fit 73",planner:"Rolling planner"};
const refs=["fit211","planner","frozen73","previous"];
const fitName=f=>f.seed+" · "+(f.seed===results.primarySeed?"release":"secondary");
const int=n=>(n>0?"+":"")+count(n);
const ci=(value,bounds,places=4)=>signed(value,places)+" ["+bounds.map(x=>signed(x,places)).join(", ")+"]";
const credit=c=>ci(c.net,c.net95,3);
const service=c=>ci(c.servicePP/10,c.service95.map(x=>x/10));
const friday=c=>ci(c.perWeek,c.perWeek95);
const trials=[
  ["More Friday deliveries than fit 211","fridayFit211","fit211","friday"],
  ["Earn more than the planner","profitPlanner","planner","credits"],
  ["Deliver more over the week than fit 73","deliveriesFrozen73","frozen73","service"],
  ["Earn more than fit 73","profitFrozen73","frozen73","credits"],
  ["Keep fit 101’s weekly deliveries","retainDeliveries101","previous","service"],
  ["Keep fit 101’s weekly earnings","retainProfit101","previous","credits"],
];
const passed=g=>trials.filter(([,key])=>g[key]).length;
const criterionRows=trials.map(([label,key,ref,measure])=>{
  const f=all.friday.comparisons[ref],w=all.comparisons[ref];
  if(measure==="friday")return [label,int(f.net),friday(f),"Friday deliveries",goals[key]?"Met":"Missed"];
  if(measure==="service")return [label,int(all.weeklyTotals[ref].netDeliveries),service(w),"All-week deliveries",goals[key]?"Met":"Missed"];
  return [label,int(all.weeklyTotals[ref].netCredits),credit(w),"Net credits",goals[key]?"Met":"Missed"];
});
const tests=table("Six preregistered comparisons on fresh weeks",["Release criterion","Total difference","Difference/week [95% interval]","Unit","Verdict"],criterionRows,"friday-tests");
const ff=all.friday.comparisons.fit211, plan=all.comparisons.planner;
const lead='<p class="finding"><strong>The release fit passed '+passed(goals)+' of six registered tests on '+count(all.weeks)+' fresh closure weeks.</strong> The intervals for Friday deliveries against frozen fit 211 and weekly earnings against the rolling planner both included zero.</p>';
const weekly='<p>Across all five days, the release delivered '+count(all.weeklyTotals.frozen73.netDeliveries)+' more contracts and earned '+count(all.weeklyTotals.frozen73.netCredits)+' more credits than original fit 73. Against frozen fit 101, it delivered '+count(all.weeklyTotals.previous.netDeliveries)+' more contracts and earned '+count(-all.weeklyTotals.previous.netCredits)+' fewer credits. The earnings difference was '+credit(all.comparisons.previous)+' credits/week.</p>';
assert(!goals.fridayFit211 && !goals.profitPlanner && all.comparisons.previous.net95[1]<0);
const strip=(items)=>'<dl class="result-strip">'+items.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join("")+'</dl>';
const top=lead+strip([["Friday deliveries vs fit 211",int(ff.net)],["Net credits/week vs planner",signed(plan.net,3)],["Tests passed",passed(goals)+" / 6"]])+weekly+tests+
  '<p>Each new fit starts with frozen fit 101’s warning move. Four tests require a positive lower 95% bound. The two retention tests allow a lower bound of exactly zero. All six must pass for the combined claim.</p>';

const accounting=table("Friday pickups compared with the original fit 73",["New fit","Fit 101 misses prevented","Misses repeated","Misses introduced","Fit 101 saves kept","Saves given up","New saves"],
  fresh.fits.map(f=>{const a=f.lossAccounting;return [fitName(f),...["prevented","remaining","introduced","kept","surrendered","newGains"].map(k=>count(a[k]))];}),"friday-accounting");
const equalContract=table("Release agent’s matched Friday contracts",["Reference","Only release delivered","Only reference delivered","Net Friday deliveries","Difference/week [95% interval]"],refs.map(ref=>{
  const c=all.friday.comparisons[ref];return [names[ref],count(c.saved),count(c.lost),int(c.net),friday(c)];
}));
const a=primary.lossAccounting;
const fridayBlock='<p>Fit 101 missed '+count(a.losses101)+' Friday contracts that original fit 73 delivered on the fresh weeks. The release recovered '+count(a.prevented)+' of those and introduced '+count(a.introduced)+' misses elsewhere. It kept '+count(a.kept)+' of fit 101’s '+count(a.gains101)+' saves.</p>'+
  '<p>A separate hindsight check found '+count(opportunity.winWinWeeks)+' fresh weeks when an available warning move could deliver more on Friday and match or improve both weekly service and earnings against fit 101. The release captured '+count(opportunity.captured)+' of those '+count(opportunity.winWinWeeks)+' opportunities.</p>'+
  accounting+section("Compare exact Friday loads across all dispatchers",equalContract)+fitReplays(fresh.fits);

const fitsTable=table("Fresh results for every independently trained fit",["Fit","Friday deliveries vs fit 211","Credits/week vs planner","All deliveries vs fit 73","Credits/week vs fit 73","All deliveries vs fit 101","Credits/week vs fit 101","Tests passed"],
  fresh.fits.map(f=>[fitName(f),int(f.friday.comparisons.fit211.net),signed(f.comparisons.planner.net,3),int(f.weeklyTotals.frozen73.netDeliveries),signed(f.comparisons.frozen73.net,3),
    int(f.weeklyTotals.previous.netDeliveries),signed(f.comparisons.previous.net,3),passed(f.goals)+" / 6"]),"friday-fits");
const otherFits=fresh.fits.map(f=>section("Fit "+fitName(f)+" · paired intervals",
  table("Fit "+f.seed+" relative to the same four references",["Reference","Friday deliveries/week","All deliveries/week","Net credits/week"],refs.map(ref=>
    [names[ref],friday(f.friday.comparisons[ref]),service(f.comparisons[ref]),credit(f.comparisons[ref])])))).join("");
const changed=table("Who proposed the chosen warning dispatch?",["Fit","Warnings","Changed fit 101’s move","Fit 211 only","Fit 73 only","Both alternatives"],fresh.fits.map(f=>{
  const d=f.decisions;return [fitName(f),...[d.warnings,d.changedWarnings,d.fit211Only,d.frozen73Only,d.bothAlternatives].map(count)];
}));
const plannerWinners=fresh.fits.filter(f=>f.goals.profitPlanner);
const notable=plannerWinners.length===1?'<p>Only new fit '+plannerWinners[0].seed+' cleared the earnings test against the rolling planner, at '+credit(plannerWinners[0].comparisons.planner)+' net credits/week. It passed '+passed(plannerWinners[0].goals)+' of the six tests.</p>':'';
const defaultEarnings=context.baselines.previous.comparison;
const inheritance='<p>Frozen fit 101 already beat the rolling planner by '+credit(defaultEarnings)+' credits/week on the same fresh bank. Secondary fit 211 earned '+count(-fresh.fits.find(f=>f.seed===211).weeklyTotals.previous.netCredits)+' fewer credits than that default. This baseline comparison was added after scoring.</p>';
const baselines=table("Frozen policies against the rolling planner on these fresh weeks",["Dispatcher","Total credits","Credits/week [95% interval]","All-week deliveries","Friday deliveries"],["previous","fit211","frozen73"].map(key=>{
  const b=context.baselines[key];return [names[key],int(b.netCredits),credit(b.comparison),int(b.netDeliveries),int(b.friday.net)];
}));
const fitBlock='<p>Seed '+results.primarySeed+' was designated for release before training. The other two seeds used their own training and selection weeks. All three saw the same held-out freight and repairs.</p>'+notable+inheritance+fitsTable+otherFits+section("Compare the frozen policies with the rolling planner",baselines)+section("Which warning moves did each fit choose?",changed);
const histTable=table("Original public closures · exact Friday pickups and weekly totals vs fit 101",["New fit","39 misses recovered / repeated","35 saves kept / given up","Misses introduced / new saves","Net Friday deliveries","All-week deliveries","All-week credits"],
  history.fits.map(f=>[fitName(f),count(f.preventedMisses)+" / "+count(f.repeatedMisses),count(f.retainedSaves)+" / "+count(f.forgoneSaves),
    count(f.introducedMisses)+" / "+count(f.newSaves),int(f.fridayDeltaVs101),int(f.weekDeliveriesVs101),int(f.netCreditsVs101)]),"original-39");
const h=history.fits.find(f=>f.seed===results.primarySeed);
function historicalContracts(title,rows) {
  return section(title,table("Previously published weeks · exact signed pickup",
    ["Week seed","Schedule","Friday pickup",...results.fitSeeds.map(seed=>"New fit "+seed)],
    rows.map(e=>[e.seed,familyName(e.family),roundName(e.epoch),...results.fitSeeds.map(seed=>e.servedByNewFits.includes(seed)?"Delivered":"Missed")])));
}
const historical='<p>On the '+count(history.weeks)+' weeks from the previous release, fit 101 missed 39 Friday contracts served by original fit 73 and saved 35 that fit 73 missed. The new release recovered '+count(h.preventedMisses)+' of the 39 and retained '+count(h.retainedSaves)+' of the 35.</p>'+
  '<p>The 74 contracts came from '+count(new Set([...history.originalMisses,...history.originalSaves].map(e=>e.seed)).size)+' weeks. These previously published cases motivated the experiment and were excluded from training and selection. The six registered tests use a separate fresh bank.</p>'+histTable+
  historicalContracts("Inspect the original 39 missed contracts",history.originalMisses)+historicalContracts("Inspect the original 35 saved contracts",history.originalSaves);
const families=table("Fresh results by freight schedule",["Schedule","Weeks","Friday deliveries/week vs fit 211","Net credits/week vs planner"],Object.entries(fresh.summary.byFamily).map(([name,g])=>
  [familyName(name),count(g.weeks),friday(g.friday.comparisons.fit211),credit(g.comparisons.planner)]));
const banks=table("Independent evaluation banks",["Bank","Weeks","Friday deliveries/week vs fit 211","Net credits/week vs planner","All deliveries/week vs fit 101"],[["Development",validation],["Fresh",fresh],["Open depots",clean],["Original double-return",archive]].map(([label,s])=>{
  const g=s.summary.all;return [label,count(g.weeks),friday(g.friday.comparisons.fit211),credit(g.comparisons.planner),service(g.comparisons.previous)];
}));
const training=table("Independent training and policy selection",["Fit","Paired warning choices in training","Selection settings meeting all goals","Service weight","Net weight","Switch hurdle","Selection result"],models.map(m=>[
  fitName(m),count(m.training.pairedExamples),m.selection.feasible+" / "+m.selection.candidates.length,m.settings.serviceWeight,m.settings.netWeight,m.settings.hurdle,
  {"joint":"Passed all selection criteria","active-fallback":"Best fallback","always-default":"Kept fit 101"}[m.selection.mode],
]));
const selection=table("Selected rule on 90,112 selection weeks · differences from frozen fit 101",
  ["Fit","Warning moves changed","Net Friday deliveries","Net all-week deliveries","Net credits"],models.map(m=>{
    const row=m.settings.alwaysDefault?{changed:0,friday:0,service:0,net:0}:
      m.selection.candidates.find(c=>Object.entries(m.settings).every(([k,v])=>c.settings[k]===v));
    assert(row);
    return [fitName(m),count(row.changed),int(row.friday),int(row.service),int(row.net)];
  }));
const methods='<p>Each fit trained on 180,224 simulated weeks and selected its settings on 90,112 separate weeks. At the closure warning it compared three frozen dispatchers’ moves. Three fitted tree models estimated the resulting changes in Friday pickups, full-week deliveries and net credits. After the warning, original fit 73 dispatched each fleet from its new positions.</p>'+
  '<p>Each Friday has two signed contracts. The benchmark pairs the same load, freight and repairs for each dispatcher. Its 95% intervals use 2,000 bootstrap draws that keep both Friday contracts within their original week and resample weeks within freight schedule.</p>'+section("How were the warning decisions trained and selected?",training+selection)+section("Compare eight fresh freight schedules",families)+section("Check development and open-depot weeks",banks);
const feature='<article class="latest-study" id="fridayguard" aria-labelledby="fridayguard-title"><div><h2 id="fridayguard-title">Protecting Friday deliveries</h2><p>Fit 101 missed 39 Friday contracts in the original study. A trained fleet now chooses when to keep its warning move. The release passed '+passed(goals)+' of six tests on '+count(all.weeks)+' fresh weeks. Only secondary fit 211 cleared the planner’s earnings test. Its earnings remained below frozen fit 101’s.</p></div>'+
  '<figure class="load-distribution"><figcaption>Release agent on fresh weeks</figcaption>'+[["Friday deliveries vs fit 211",int(ff.net)],["Earnings vs planner",signed(plan.net,3)+" credits/week"],["Fit 101 misses recovered",count(a.prevented)+" / "+count(a.losses101)]].map(([label,value])=>
  '<div class="load-bin"><strong>'+label+'</strong><span>'+value+'</span></div>').join("")+'</figure><nav aria-label="Friday protection study"><a href="./fridayguard.html#results">Read the results →</a><a href="./fridayguard.html#friday">Replay Friday pickups →</a><a href="./fridayguard.html#historical">Revisit the 39 misses →</a><a href="./fridayguard.html#own-agent">Benchmark your agent →</a></nav></article>';

await writeSections("fridayguard","fridayguard.html",{results:top,friday:fridayBlock,fits:fitBlock,historical,methods});
await writeSections("fridayguard","studies.html",{feature});
await writeSampleReport(data,results.suite,validation,"EvalSim Friday protection fleet",verifyFridayGuardReport);
