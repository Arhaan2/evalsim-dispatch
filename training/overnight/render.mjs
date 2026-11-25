import {readFile, writeFile} from "node:fs/promises";
import {FLEET_DEPOTS} from "../../docs/lib/fleetweek.js";
import {pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {traceActions, roundName, familyName, branchLabel, dispatchText, moveName} from "../../docs/lib/overnight-view.js";

const docs = new URL("../../docs/",import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path,docs),"utf8"));
const data = await read("data/overnight/results.json");
const prior = await read("data/fleetweek/results.json");
const fresh = data.splits.test, archive = data.splits.archive;
const all = fresh.summary.all, planner = all.comparisons.planner;
const oldReturn = prior.splits.test.summary.byFamily["double-return"];
const archiveBank = await read("data/overnight/archive.json");
const oldOnNew = pairedFleetComparison(archiveBank.cases.map(row=>({family:row.family,agent:row.previous.ledger, planner:row.planner.ledger})),"planner");
const n = (v,d=2) => v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const signed = (v,d=2) => (v>0?"+":"")+n(v,d);
const interval = (v,d=2) => "["+v.map(x=>signed(x,d)).join(", ")+"]";
const difference = (c,service=false) => service ? signed(c.servicePP,3)+" "+interval(c.service95,3) : signed(c.net)+" "+interval(c.net95);
const pct = v => n(v)+"%";
const count = v => n(v,0);
const distance = (v,unit) => n(Math.abs(v))+" "+(v<0?"fewer ":"more ")+unit;
const pass = b => b?"Passed":"Missed";
const stamp = x => x.family+"-"+x.seed+"-"+x.epoch;

// Every string in these tables comes from a checked-in reference release or the fixed public world.
function table(title,headings,rows,extra="") {
  let html='<div class="table-frame" tabindex="0" role="region" aria-label="'+title+'"><table class="'+extra+'"><caption>'+title+
    '</caption><thead><tr>'+headings.map(h=>'<th scope="col">'+h+'</th>').join("")+'</tr></thead><tbody>';
  for(const row of rows) html+='<tr><th scope="row">'+row[0]+'</th>'+row.slice(1).map(c=>'<td>'+c+'</td>').join("")+'</tr>';
  return html+'</tbody></table></div>';
}
function caseMarkup(example) {
  const {epoch, seed, family} = example;
  const fork = [example.chosen,example.alternative].map(row=>traceActions({family,seed},row.actions));
  const chosen = fork[0].trace[epoch], obs=chosen.observation;
  const branches = fork.map((run,i)=>{
    const frame=run.trace[epoch], kind=frame.action.moves.some(code=>code.startsWith("E"))?"move":"stay";
    return {run,kind,label:branchLabel(frame),selected:i===0,frame};
  }).sort((a,b)=>Number(a.kind==="stay")-Number(b.kind==="stay"));
  const [move,stay] = branches;
  const gain = move.run.ledger.net-stay.run.ledger.net;
  const booked = chosen.action.moves.flatMap((code,i)=>code==="W"||code.startsWith("E") ? [] : ["Truck "+(i+1)+" takes "+moveName(code,obs,i).toLowerCase().replace(/harbor|inland|junction/g, x=>x[0].toUpperCase()+x.slice(1))]);
  const locations = obs.positions.map((d,i)=>"Truck "+(i+1)+" at "+FLEET_DEPOTS[d]).join(" · ");
  const forecast=obs.forecast[epoch+1].map((p,i)=>FLEET_DEPOTS[i]+" "+Math.round(100*p)+"%").join(" · ");
  const caption = roundName(epoch)+" · "+familyName(family);
  const summary = table("Same freight through Friday",["Dispatch","Tonight’s net","Next morning’s net","Week net","Contracts served"],
    branches.map(b=>[b.kind==="move"?"Move empty":"Stay",count(b.frame.action.net),count(b.run.trace[epoch+1].action.net),count(b.run.ledger.net),b.run.ledger.served+" / 10"]));
  const path = table("Truck 1 and truck 2, in order",["Round","Move branch","Stay branch"],move.run.trace.map((frame,t)=>
    [roundName(t),dispatchText(frame)+" · "+frame.action.net+" net",dispatchText(stay.run.trace[t])+" · "+stay.run.trace[t].action.net+" net"]),"journey");
  const outcome = gain===0 ? "Both choices earned the same amount this week." : "Moving empty earned "+count(Math.abs(gain))+(gain>0?" more":" fewer")+" net credits than staying by Friday.";
  return '<article class="night-case" data-case="'+stamp(example)+'"><h3>'+caption+'</h3><p class="night-record">Week '+seed+' · '+locations+'</p>'+
    '<div class="public-board"><div><h4>Bookings for this afternoon</h4><p>'+(booked.length?booked.join(". ")+".":"Both trucks are available.")+'</p></div>'+
    '<div><h4>Forecast for the next morning</h4><p>'+forecast+'</p></div></div>'+
    '<div class="call-row" hidden>'+branches.map(b=>'<button type="button" data-pick="'+b.kind+'" data-net="'+b.run.ledger.net+'" aria-pressed="false">'+b.label+' · '+b.frame.action.emptyCost+' credits</button>').join("")+'</div>'+
    '<p class="call-status" aria-live="polite"></p><details class="outcome"><summary>Compare both outcomes</summary><p><strong>'+outcome+'</strong> The learned dispatcher chose to '+(move.selected?"move empty":"stay")+
    '.</p>'+summary+'<details><summary>Follow both trucks through all ten rounds</summary>'+path+'</details>'+
    '</details><a class="case-link" href="./overnight.html?case='+stamp(example)+'#play">Link to this night</a></article>';
}
const d=fresh.diagnostics;
const replay = d.examples.length ? '<div class="case-list" hidden><label for="case-select">Choose a night</label><select id="case-select">'+
  d.examples.map(e=>'<option value="'+stamp(e)+'">'+roundName(e.epoch)+' · '+familyName(e.family)+' · '+e.seed+'</option>').join("")+
  '</select></div>'+d.examples.map(caseMarkup).join("\n")+
  '<p class="sample-note">Replays represent typical gains or losses for moving or staying. Each is the available example closest to the median difference for its group on the fresh test.</p>' :
  '<p>The two branches tied on every eligible night. The full-week scores appear below.</p>';
const policies = [["rl","Overnight agent"],["planner","Rolling planner"],["previous","Original fleet RL"],
  ["noEmpty","Overnight agent, empty moves disabled on these nights"],["greedy","Greedy dispatcher"]];
const top = table("Per dispatcher on "+count(all.weeks)+" fresh weeks",["Dispatcher","Net credits / week","Contracts on time","Empty miles / week"],policies.map(([key,name])=>{
  const p=all.policies[key];return [name,n(p.net),pct(p.onTime),n(p.emptyMiles)];
}));
const ar=archive.summary.all;
const gates=table("Checks fixed before fitting",["Goal","Agent minus planner, paired 95% interval","Result"],[
  ["Fresh-week earnings (credits)",difference(planner),pass(data.goals.freshProfit)],
  ["Fresh-week on-time rate (percentage points)",difference(planner,true),pass(data.goals.freshService)],
  ["Original double-return earnings (credits)",difference(ar.comparisons.planner),pass(data.goals.doubleReturn)],
]);
const outcomes=table("Selected overnight choice versus its alternative through Friday",["Choice","Nights","Helped","Tied","Hurt","Mean net change per choice"],[["Move empty",d.move],["Stay",d.stay]].map(([label,group])=>
  [label,count(group.nights),count(group.helped),count(group.tied),count(group.hurt),group.nights?signed(group.netGain/group.nights):"—"]));
const changes=d.plannerChanges;
const casesByFamily = Object.entries(fresh.summary.byFamily).map(([family,s])=>[familyName(family),count(s.weeks),difference(s.comparisons.planner),difference(s.comparisons.planner,true)]);
const fits = fresh.fits.map((f,i)=>[f.seed+(f.seed===data.primarySeed?" · release":""),n(f.net),pct(f.onTime),difference(f.planner),difference(archive.fits[i].planner)]);
const archival = table("Original double-return schedule on "+count(ar.weeks)+" new weeks",["Dispatcher","Net credits / week","Contracts on time"],policies.slice(0,3).map(([k,name])=>[name,n(ar.policies[k].net),pct(ar.policies[k].onTime)]));
const overall = planner.net===0?"earned the same net credits per week as the planner":"earned "+distance(planner.net,"net credits per week")+" than the planner";
const results = '<p><strong>The overnight agent '+overall+'.</strong> It served '+pct(all.policies.rl.onTime)+' of contracts on time, compared with '+pct(all.policies.planner.onTime)+' for the planner.</p>'+
  top+gates+'<h3>When empty travel paid off</h3><p>Against the same agent with every Monday–Thursday overnight empty move converted to a wait, the learned rule earned '+difference(all.comparisons.noEmpty)+' credits per week and changed on-time service by '+difference(all.comparisons.noEmpty,true)+' percentage points.</p>'+
  '<p>A truck could move or stay on '+count(d.eligible)+' of '+count(d.nights)+' Monday–Thursday nights. Both branches keep the same signed loads, decide one night differently, then follow the same learned rule through Friday. A week can contribute several nights.</p>'+outcomes+
  '<p>The learned rule changed the planner’s overnight dispatch '+count(changes.nights)+' times. It initiated an empty move '+count(changes.toMove)+' times, stayed '+count(changes.toStay)+' times, and changed an empty move’s destination or truck assignment '+count(changes.redirect)+' times. Against the planner’s move from the same starting point, these changes helped on '+count(changes.helped)+' nights, tied on '+count(changes.tied)+' and hurt on '+count(changes.hurt)+'.</p>'+
  '<details><summary>Original double-return comparison</summary><p>The previous fleet release earned '+difference(oldReturn.comparisons.planner)+' credits per week over the planner on its original '+count(oldReturn.weeks)+' double-return weeks. The new archive uses distinct seeds on that schedule. Every dispatcher below faced exactly the same new weeks.</p>'+archival+
  '<p>On the new double-return weeks, the original fleet agent earned '+difference(oldOnNew)+' credits per week over the planner. The overnight agent earned '+difference(ar.comparisons.planner)+' against the same planner and '+difference(ar.comparisons.previous)+' against the original agent.</p></details>'+
  '<details><summary>Four unseen market schedules</summary>'+table("Fresh schedule results with paired 95% intervals",["Schedule","Weeks","Net credits vs planner","On-time difference (pp)"],casesByFamily)+'</details>'+
  '<details><summary>Five independent training runs</summary>'+table("Five fits scored on identical weeks",["Training seed","Fresh net credits","Fresh on time","Fresh net vs planner","Double-return net vs planner"],fits)+'</details>';
const feature = '<article class="latest-study" id="overnight" aria-labelledby="overnight-title"><div><h2 id="overnight-title">Move the empty truck?</h2><p>Across '+count(all.weeks)+' fresh weeks, the overnight agent '+overall+'. On new weeks from the original double-return schedule, its net difference was '+signed(ar.comparisons.planner.net)+' credits per week.</p></div>'+
  '<figure class="load-distribution"><figcaption>Fresh contracts served on time</figcaption>'+[["rl","Overnight agent"],["planner","Rolling planner"]].map(([key,label])=>'<div class="load-bin"><strong>'+label+'</strong><span>'+pct(all.policies[key].onTime)+'</span><div class="load-bar" aria-hidden="true"><i style="width:'+n(all.policies[key].onTime)+'%"></i></div></div>').join("")+
  '</figure><nav aria-label="Overnight fleet"><a href="./overnight.html">Make the overnight call →</a><a href="./overnight.html#results">Read the results →</a><a href="./overnight.html#own-agent">Benchmark your agent →</a></nav></article>';
async function update(file,marker,content) {
  const path=new URL(file,docs), original=await readFile(path,"utf8");
  const start="<!-- "+marker+"-start -->", end="<!-- "+marker+"-end -->";
  const first=original.indexOf(start), last=original.indexOf(end);
  if (first<0 || last<=first) throw Error("Missing evidence markers in "+file);
  const rendered=original.slice(0,first+start.length)+"\n"+content+"\n"+original.slice(last);
  if (process.argv.includes("--check")) {
    if(rendered!==original) throw Error(file+" differs from the measured overnight evidence.");
  } else await writeFile(path,rendered);
}
await update("overnight.html","overnight-results",results);
await update("overnight.html","overnight-replays",replay);
await update("studies.html","overnight-feature",feature);
