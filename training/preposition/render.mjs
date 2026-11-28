import {readFile} from "node:fs/promises";
import {familyName, roundName} from "../../docs/lib/overnight-view.js";
import {verifyPrepositionReport} from "../../docs/lib/preposition-benchmark.js";
import {count, digits, signed, table, writeSections} from "../fleetweek/render-decisions.mjs";
import {interval, section, writeSampleReport} from "../closure/repair-tables.mjs";
import {renderFridayChallenge} from "./challenge.mjs";

const data = new URL("../../docs/data/preposition/",import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name,data),"utf8"));
const [result,fitAudit,controls] = await Promise.all([read("results.json"),read("fit-deliveries.json"),read("matched-controls.json")]);
const models = await Promise.all(result.fitSeeds.map(seed=>read("fit-"+seed+".json")));
const {validation,test:fresh,clean,archive} = result.splits;
const all = fresh.summary.all, effects = all.comparisons;
const labels = {rl:"Preposition RL",previous:"Frozen fit 73",planner:"Rolling planner",shortGate:"Always short",flatRisk:"Constant penalty"};
const comparators = ["previous","planner","shortGate","flatRisk"];
const deliveryInterval = c => signed(c.servicePP/10,4)+" ["+c.service95.map(v=>signed(v/10,4)).join(", ")+"]";
const signedCount = n => (n>0?"+":"")+count(n);
const registrations = [
  ["Deliver more than fit 73","previous","deliveriesFit73",true],
  ["Deliver more than the planner","planner","deliveriesPlanner",true],
  ["Earn more than fit 73","previous","profitFit73",false],
  ["Earn more than the planner","planner","profitPlanner",false],
];
function finding(c, service) {
  const ci=service ? c.service95 : c.net95;
  if (ci.every(v=>v===0)) return "Matched on this bank";
  if (ci[0]>0) return "Higher";
  if (ci[1]<0) return "Lower";
  return "Inconclusive";
}
const official = table("Four registered tests",["Study criterion","RL difference per week [95% interval]","Measure","Result"],
  registrations.map(([criterion,key,goal,service])=>[criterion,service?deliveryInterval(effects[key]):interval(effects[key]),
    service?"Contracts":"Net credits",result.goals[goal]?"Met":finding(effects[key],service)]),"test-totals");
const d = fresh.contracts.previous;
const fridayNet = d.fridaySaved-d.fridayLost;
function relative(n,unit) {
  if(n===0) return "the same number of "+unit+" as";
  return count(Math.abs(n))+" "+(n<0?"fewer":"more")+" "+unit+" than";
}
const top = '<p class="finding"><strong>The release agent kept frozen fit 73’s dispatch on all '+count(all.weeks)+' fresh weeks.</strong> The two fleets made the same deliveries and earned the same credits. They delivered '+relative(fresh.contracts.planner.net,"contracts")+' the rolling planner. Their earnings lead of '+signed(effects.planner.net,3)+' credits/week had a 95% interval spanning zero.</p>';
const alternates=fitAudit.fits.filter(f=>f.seed!==result.primarySeed);
const alternateText='<p><strong>Two independently trained fits did move the trucks.</strong> '+alternates.map(f=>
  'Fit '+f.seed+' changed the depot arrangement on '+count(f.positions.differentPlacement)+' warnings, delivered '+relative(f.net,"contracts")+' frozen fit 73 and earned '+signed(fresh.fits.find(row=>row.seed===f.seed).previous.net,3)+' extra credits/week').join('. ')+
  '. Both improved on fit 73 in service and earnings, and both improved on the rolling planner in service. Each fit’s earnings interval against the planner still spans zero. These secondary fits were fixed before the test.</p>'+
  '<p>Friday alone shows the trade-off. '+alternates.map(f=>'Fit '+f.seed+' saved '+count(f.fridaySaved)+' contracts that fit 73 missed and missed '+count(f.fridayLost)+' that fit 73 delivered').join('. ')+'. You can play one save and one miss from each fit on the warning board.</p>';
const nPassed=registrations.filter(([, ,goal])=>result.goals[goal]).length;
const method = '<p>The release agent passed '+nPassed+' of four registered tests. Each required a positive lower 95% bound on paired whole weeks. The intervals resample complete weeks within each of the eight fresh freight schedules.</p>';
const absolute=table("Fleet operations over the same fresh weeks",["Dispatcher","Contracts on time","Net credits/week","Empty miles/week"],Object.entries(labels).map(([k,label])=>{
  const p=all.policies[k];return [label,digits(p.onTime,2)+"%",digits(p.net,2),digits(p.emptyMiles,2)];
}));
const netControls=table("Differences on fresh weeks [paired 95% intervals]",["Compared with","Contracts/week","Net credits/week"],
  comparators.map(k=>[labels[k],deliveryInterval(effects[k]),interval(effects[k])]));
const matched=table("Contracts served by only one dispatcher",["RL compared with","Saved by RL","Missed by RL","Net deliveries","Friday saved","Friday missed"],
  comparators.map(k=>{const c=fresh.contracts[k];return [labels[k],count(c.saved),count(c.lost),signedCount(c.net),count(c.fridaySaved),count(c.fridayLost)];}),"delivery-counts");
const placementRows = [["differentPlacement","Different depot arrangement"],["swappedTrucks","Truck IDs swapped between the same depots"],
  ["samePositions","Different freight, same truck positions"],["unchanged","Same warning dispatch"]];
const placement=table("How the warning move changed the route relative to fit 73",
  ["Warning dispatch","Weeks","Net credits through Friday","Net deliveries on warning board","Net deliveries after warning","Friday saves / misses"],
  placementRows.map(([key,label])=>{const v=fresh.positioning[key];return [label,count(v.weeks),signedCount(v.netCredits),signedCount(v.atWarningSaved-v.atWarningLost),
    signedCount(v.afterSaved-v.afterLost),count(v.fridaySaved)+" / "+count(v.fridayLost)];}));
const timing='<p>The trained agent sent the trucks to a different arrangement of depots on '+count(fresh.positioning.differentPlacement.weeks)+' warnings. With the same final truck positions, taking a different load can still change earnings or serve the warning round’s contract. The table counts each week once according to the warning decision.</p>';
const byBoard=table("The same signed delivery in each half-day",["Round","Saved vs fit 73","Missed vs fit 73","Saved vs planner","Missed vs planner"],
  d.byEpoch.map((r,i)=>[roundName(i),count(r.saved),count(r.lost),count(fresh.contracts.planner.byEpoch[i].saved),count(fresh.contracts.planner.byEpoch[i].lost)]));
const register = '<h3 id="deliveries">Which contracts changed?</h3><p>Each round has one signed load. A save means RL served that exact load and the comparator missed it. A miss means the comparator served it and RL did not. Friday alone saw '+count(d.fridaySaved)+' saves and '+count(d.fridayLost)+' misses against fit 73 ('+signedCount(fridayNet)+' deliveries).</p>';
const markets=table("Fresh freight schedules",["Market","Weeks","Contracts/week vs fit 73","Net credits/week vs fit 73","Contracts/week vs planner","Net credits/week vs planner"],
  Object.entries(fresh.summary.byFamily).map(([key,g])=>[familyName(key),count(g.weeks),deliveryInterval(g.comparisons.previous),interval(g.comparisons.previous),
    deliveryInterval(g.comparisons.planner),interval(g.comparisons.planner)]));
const repairs=table("Closed half-days observed by Friday",["Duration","Weeks","Contracts/week vs fit 73","Net credits/week vs fit 73","Contracts/week vs planner","Net credits/week vs planner"],
  Object.entries(fresh.byDuration).map(([key,g])=>[key,count(g.weeks),deliveryInterval(g.comparisons.previous),interval(g.comparisons.previous),deliveryInterval(g.comparisons.planner),interval(g.comparisons.planner)]));
const banks=table("All four evaluation banks",["Bank","Weeks","Warning moves changed","Net credits/week vs planner","Contracts/week vs planner"],
  [["Practice closures",validation],["Fresh closures",fresh],["Open depots",clean],["Original double-return",archive]].map(([label,s])=>[label,count(s.summary.all.weeks),count(s.diagnostics.changedWarnings),interval(s.summary.all.comparisons.planner),deliveryInterval(s.summary.all.comparisons.planner)]));
const fits=table("Training choices and independent fresh-week outcomes",["Fit","Extra value per contract / hurdle","Contracts/week vs fit 73","Net credits/week vs fit 73","Contracts/week vs planner","Net credits/week vs planner"],
  fresh.fits.map((f,i)=>[f.seed+(f.seed===result.primarySeed?" · release":""),models[i].settings.serviceCredit+" / "+models[i].settings.hurdle,
    deliveryInterval(f.previous),interval(f.previous),deliveryInterval(f.planner),interval(f.planner)]));
const fitDeliveries=table("Warning dispatches and signed contracts by fit, compared with frozen fit 73",["Fit","Warning moves changed","Different depot arrangement","Saved / missed all week","Net deliveries on warning","Net deliveries after warning","Friday saved / missed"],
  fitAudit.fits.map(f=>[f.seed+(f.seed===result.primarySeed?" · release":" · secondary"),count(f.changedWarnings),count(f.positions.differentPlacement),
    count(f.saved)+" / "+count(f.lost),signedCount(f.atWarningSaved-f.atWarningLost),signedCount(f.afterSaved-f.afterLost),count(f.fridaySaved)+" / "+count(f.fridayLost)]));
const examples=[
  ...fresh.examples.filter(e=>e.kind!=="alternative"),
  ...fitAudit.fits.filter(f=>f.seed!==result.primarySeed).flatMap(f=>f.examples),
  ...fresh.examples.filter(e=>e.kind==="alternative"),
];
const addedValue=table("What the learned warning decision contributed [paired 95% intervals]",["Release compared with","Contracts/week","Net credits/week"],
  [["warningPlanner","Rolling planner on the warning only"],["untrained","Same warning rule with fitted heads set to zero"]].map(([k,label])=>[label,deliveryInterval(effects[k]),interval(effects[k])]));
const matchedControls=table("Supplemental test against the same dispatcher with its fitted values set to zero",["Fit","Warning choices differed","Net deliveries","Contracts/week [95% interval]","Net credits/week [95% interval]"],
  controls.fits.map(f=>[f.seed,count(f.differentWarnings),signedCount(f.netDeliveries),deliveryInterval(f.comparison),interval(f.comparison)]));
const mechanism='<p>Each comparison below keeps the fit’s switching threshold and contract weight fixed and sets its learned estimates to zero. Fits 101 and 211 each earned more and delivered more with the estimates enabled. The release agent chose the same moves either way. This supplemental test was added after official scoring.</p>';
const training=models.find(m=>m.seed===result.primarySeed).training;
const learned='<p>For each fit, the simulator replayed every legal warning dispatch on the same freight and repairs. The trucks then followed fit 73 from their new locations until Friday. Two learned values estimate future credits and signed deliveries. The agent can use the current trucks, freight, forecasts and public repair warning.</p>'+
  '<p>The primary fit trained on '+count(training.weeks)+' weeks and compared '+count(training.legalActionBranches)+' legal action branches. Fifteen service weights and switching thresholds were tested on independent selection weeks. Seed '+result.primarySeed+' was named for release before fitting. Once the warning passes, all fits use the frozen dispatcher.</p>';
const selectionEpochs=fitAudit.primarySelectionTiming.byEpoch;
const selectionNote='<p>A follow-up looked at the release fit’s warning times. All '+count(selectionEpochs.reduce((total,row)=>total+row.changed,0))+' changes on its selection weeks happened in the afternoon. It changed zero of '+count(selectionEpochs.filter(row=>row.epoch%2===0).reduce((total,row)=>total+row.weeks,0))+' Tuesday, Wednesday or Thursday morning warnings. The fresh bank uses those three morning warnings.</p>';
const retention='<p>Without a warning the fleet follows fit 73. On the original double-return bank its earnings difference against the planner was '+interval(archive.summary.all.comparisons.planner)+' credits/week. That comparison measures the inherited open-depot policy.</p>';
const blocks = [top,method,official,'<h3 id="independent-fits">What changed in the other two fits?</h3>',alternateText,fitDeliveries,register,matched,
  section("See which warning moves changed later deliveries",timing+placement+byBoard),
  section("Compare weekly earnings, service and empty miles",absolute+netControls),
  section("Compare schedules, repair lengths and open-depot weeks",markets+repairs+retention+banks),
  section("What the fitted values contributed",learned+selectionNote+addedValue+fits+mechanism+matchedControls)].join("\n");
const feature='<article class="latest-study" id="preposition" aria-labelledby="preposition-title"><div><h2 id="preposition-title">Can you save Friday’s delivery?</h2>'+
  '<p>Make a dispatch before the depot closes. The release agent kept fit 73’s plan on every fresh week and passed '+nPassed+' of four tests. Two secondary fits saved deliveries and earned more than fit 73. Earnings against the rolling planner remain uncertain.</p></div>'+
  '<figure class="load-distribution"><figcaption>On '+count(all.weeks)+' fresh weeks</figcaption>'+
  [["Release vs planner",signedCount(fresh.contracts.planner.net)+" deliveries"],...alternates.map(f=>["Fit "+f.seed+" vs fit 73",signedCount(f.net)+" deliveries"])]
  .map(([label,value])=>'<div class="load-bin"><strong>'+label+'</strong><span>'+value+'</span></div>').join('')+
  '</figure><nav aria-label="Fleet positioning study"><a href="./preposition.html">Play the Friday challenge →</a><a href="./preposition.html#results">Read the results →</a><a href="./preposition.html#independent-fits">Compare the fits →</a><a href="./preposition.html#own-agent">Benchmark your agent →</a></nav></article>';
await writeSections("preposition","preposition.html",{play:renderFridayChallenge(examples),results:blocks});
await writeSections("preposition","studies.html",{feature});
await writeSampleReport(data,result.suite,validation,"EvalSim preposition fleet",verifyPrepositionReport);
