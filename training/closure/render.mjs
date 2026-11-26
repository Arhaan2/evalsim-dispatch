import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {verifyClosureReport} from "../../docs/lib/closure-benchmark.js";
import {FLEET_DEPOTS} from "../../docs/lib/fleetweek.js";
import {closureProbabilities} from "../../docs/lib/closure-world.js";
import {incidentText,traceClosure} from "../../docs/lib/closure-view.js";
import {familyName,roundName,dispatchText,moveName} from "../../docs/lib/overnight-view.js";
import {table,signed,count,digits,percentage,writeSections} from "../fleetweek/render-decisions.mjs";

const result=JSON.parse(await readFile(new URL("../../docs/data/closure/results.json",import.meta.url),"utf8"));
const {test:fresh,archive,clean}=result.splits;
const {goals}=result;
const all=fresh.summary.all, diagnostics=fresh.diagnostics;
const format=(c,service=false)=>{
  const value=service ? c.servicePP : c.net, bounds=service ? c.service95 : c.net95;
  return signed(value,3)+" ["+bounds.map(n=>signed(n,3)).join(", ")+"]";
};
const stamp=e=>e.seed+"-"+e.epoch;

function challenge(e) {
  const t=e.epoch, selectedConstant=e.chosenId===e.constantId;
  const paths=(selectedConstant?[e.chosen,e.alternative]:[e.alternative,e.chosen]).map(r=>{
    const path=traceClosure(e,r.actions);
    assert.deepEqual(path.ledger,r.ledger);
    return path;
  });
  const [base,alternative]=paths;
  const board=base.trace[t].observation,{incident}=board;
  assert(["warning","closed"].includes(incident.status));
  assert.equal(base.trace[t].action.id,e.constantId);
  assert.equal(alternative.trace[t].action.id,e.proposalId);
  const affected=FLEET_DEPOTS[incident.depot];
  const openChance=closureProbabilities(board);
  const changes=base.trace.filter(({observation},i)=>i===0 || incidentText(observation.incident)!==incidentText(base.trace[i-1].observation.incident));
  const timeline=changes.map(({observation:b})=>roundName(b.epoch)+" · "+incidentText(b.incident)).join("<br>");
  const depotList=FLEET_DEPOTS.map((name,i)=>{
    const status=i===incident.depot ? (incident.status==="closed"?"Closed":"Closing") : "Open";
    return '<li'+(i===incident.depot?' class="affected"':'')+'>'+name+' <span>'+status+'</span></li>';
  }).join("");
  const update=incident.status==="warning" ? "Repairs start "+roundName(incident.start)+". The reopening time is unknown." :
    incident.update ? "The repair crew reports that work is "+(incident.update==="on-track"?"on track.":"delayed.") : "The repair crew has yet to post an update.";
  const chance=t<9 ? " The public forecast puts the chance of closure next round at "+digits(openChance[t+1]*100,0)+"%." : "";
  const trucks=board.positions.map((depot,i)=>{
    const move=base.trace[t].action.moves[i];
    return '<p><strong>Truck '+(i+1)+'</strong> at '+FLEET_DEPOTS[depot]+' · '+(/^(W|E[012])$/.test(move)?"available":moveName(move,board,i))+'</p>';
  }).join("");
  const changed=base.trace[t].action.moves.map((move,i)=>move!==alternative.trace[t].action.moves[i]);
  const names=paths.map(path=>path.trace[t].action.moves.flatMap((move,i)=>changed[i]?["Truck "+(i+1)+" · "+moveName(move,board,i)]:[]).join(" / "));
  const choices=paths.map((path,i)=>{
    const a=path.trace[t].action;
    return '<div class="shift-choice"><button type="button" data-pick="'+i+'" data-net="'+path.ledger.net+'" aria-pressed="false"><strong>'+names[i]+'</strong><span>'+
      a.emptyMiles+' empty miles · '+a.emptyCost+' travel credits this round</span></button></div>';
  }).join("");
  const stats=table("Same freight through Friday",["Your choice","Week net","On time","Empty miles"],
    paths.map((p,i)=>[names[i],p.ledger.net,p.ledger.served+" / "+p.ledger.contracts,p.ledger.emptyMiles]));
  const journey=table("Both trucks on every round",["Round","Depot notice","Constant-penalty move first","Alternative move first"],
    base.trace.map(({observation:b},i)=>[roundName(i),incidentText(b.incident),...paths.map(p=>dispatchText(p.trace[i])+" · "+p.trace[i].action.net+" net")]),"journey");
  const difference=alternative.ledger.net-base.ledger.net;
  const finding=difference===0 ? "Both choices earned the same net credits through Friday." :
    "The alternative earned "+Math.abs(difference)+(difference>0?" more":" fewer")+" net credits through Friday.";
  return '<article class="night-case" data-case="'+stamp(e)+'"><h3>'+roundName(t)+'</h3>'+
    '<div class="notice-board"><div><h4>'+affected+(incident.status==="warning"?" will close":" is closed")+'</h4><p>'+update+chance+'</p></div>'+
    '<ul class="depot-list" aria-label="Depot status">'+depotList+'</ul></div><div class="fleet-position">'+trucks+'</div>'+
    '<div class="call-row shift-choices" hidden>'+choices+'</div><noscript><p>Choices: '+names.join(" or ")+'.</p></noscript>'+
    '<p class="call-status" role="status"></p><details class="outcome"><summary>Reveal both Friday outcomes</summary><p><strong>'+finding+'</strong> The constant-penalty dispatcher chose “'+names[0]+'”. RL chose “'+
    names[selectedConstant?0:1]+'”. The released RL agent handled all later decisions on both paths.</p>'+stats+
    '<details><summary>Repair timeline and truck log</summary><p>'+timeline+'</p>'+journey+'</details></details>'+
    '<a class="case-link" href="./closure.html?case='+stamp(e)+'#play">Link to this decision</a></article>';
}
function play(examples) {
  if (!examples.length) throw Error("The public challenge requires at least one playable decision.");
  const options=examples.map(e=>'<option value="'+stamp(e)+'">'+roundName(e.epoch)+' · week '+e.seed+'</option>').join("");
  return '<div class="case-list" hidden><label for="case-select">Choose a week</label><select id="case-select">'+options+'</select></div>'+
    examples.map(challenge).join("\n")+'<p class="sample-note">Each replay shows a result nearest the middle of its group among paired decisions from the first 32 test weeks per schedule. The choices keep the same freight assignments and change empty-truck placement on one round.</p>';
}
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
await writeSections("closure","closure.html",{play:play(fresh.examples),results:summary});
await writeSections("closure","studies.html",{feature});

const validation=JSON.parse(await readFile(new URL("../../docs/data/closure/validation.json",import.meta.url),"utf8"));
const sample={suite:result.suite,version:1,split:"validation",policy:"EvalSim closure RL",
  cases:validation.cases.map(({family,seed,closure,rl})=>({family,seed,closure,...rl})),summary:result.splits.validation.summary};
const sampleBytes=JSON.stringify(verifyClosureReport(sample,null,validation))+"\n";
const samplePath=new URL("../../docs/data/closure/sample-report.json",import.meta.url);
if(process.argv.includes("--check")) assert.equal(await readFile(samplePath,"utf8"),sampleBytes,"sample report differs from the verified public policy");
else await writeFile(samplePath,sampleBytes);
