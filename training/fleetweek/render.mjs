import {readFile, writeFile} from "node:fs/promises";
const root = new URL("../../docs/",import.meta.url);
const data = JSON.parse(await readFile(new URL("data/fleetweek/results.json",root),"utf8"));
const test = data.splits.test, all = test.summary.all, policies = all.policies, delta = all.comparisons.planner;
const num = n => n.toFixed(2);
const sign = n => (n > 0 ? "+" : "") + num(n);
const ci = (values) => "[" + values.map(sign).join(", ") + "]";
const serviceCI = values => "[" + values.map(n=>(n>0?"+":"")+n.toFixed(3)).join(", ") + "]";
const pretty = key => key.split("-").map((word,i)=>i ? word : word[0].toUpperCase()+word.slice(1)).join(" ");
function table(caption, headings, rows) {
  return '<div class="table-frame" tabindex="0" role="region" aria-label="' + caption + '"><table><caption>' + caption +
    '</caption><thead><tr>' + headings.map(h=>'<th scope="col">'+h+'</th>').join("") + '</tr></thead><tbody>' +
    rows.map(row=>'<tr><th scope="row">'+row[0]+'</th>'+row.slice(1).map(v=>'<td>'+v+'</td>').join("")+'</tr>').join("") + '</tbody></table></div>';
}
const verdict = all.beatsPlanner ? "The trained dispatcher met the earnings and service win criteria." : "The trained dispatcher missed the combined earnings and service win criteria.";
const overview = "The agent earned " + sign(delta.net) + " credits per week versus the planner (paired 95% interval " + ci(delta.net95) +
  "). Its on-time service difference was " + sign(delta.servicePP) + " percentage points " + serviceCI(delta.service95) + ".";
const totals = table("Per dispatcher on 2,048 fresh weeks",["Dispatcher","Net credits / week","Contracts on time","Empty miles / week","Weeks serving ≥7 of 10"],
  [["rl","Trained RL"],["planner","Rolling planner"],["greedy","Greedy"]].map(([key,name])=>{
    const p=policies[key];return [name,num(p.net),num(p.onTime)+"%",num(p.emptyMiles),p.targetWeeks+" / "+all.weeks];
  }));
const byFamily = table("Release agent minus planner, with paired 95% intervals",
  ["Fresh schedule","Net credits / week","On-time difference (pp)"],Object.entries(test.summary.byFamily).map(([key,g])=>{
    const c=g.comparisons.planner;return [pretty(key),sign(c.net)+" "+ci(c.net95),sign(c.servicePP)+" "+serviceCI(c.service95)];
  }));
const bySeed = table("Five independently trained fits on the same test weeks",["Training seed","Net credits / week","Versus planner","On time"],
  test.fits.map(f=>[f.seed+(f.seed===data.primarySeed?" · release":""),num(f.net),sign(f.planner.net)+" "+ci(f.planner.net95),num(f.onTime)+"%"]));
const results = '<p><strong>'+verdict+'</strong> '+overview+'</p>'+totals+
  '<p>The agent earned more than the planner on '+delta.wins+' weeks, tied on '+delta.ties+', and earned less on '+delta.losses+
  '. Its mean lead over the immediate-net greedy dispatcher was '+sign(all.comparisons.greedy.net)+' credits per week.</p>'+
  '<details><summary>Four fresh market schedules</summary>'+byFamily+'</details>'+
  '<details><summary>All five training runs</summary>'+bySeed+'</details>';
const feature = '<article class="latest-study" id="fleet" aria-labelledby="latest-title"><div><h2 id="latest-title">Where should the trucks finish today?</h2>'+
  '<p>Run a two-truck fleet through Friday. On 2,048 fresh weeks the trained dispatcher earned '+sign(delta.net)+' credits per week versus the rolling planner.</p></div>'+
  '<figure class="load-distribution"><figcaption>Contracts served on time</figcaption>'+
  [["rl","Trained RL"],["planner","Planner"]].map(([key,label])=>'<div class="load-bin"><strong>'+label+'</strong><span>'+num(policies[key].onTime)+'%</span><div class="load-bar" aria-hidden="true"><i style="width:'+num(policies[key].onTime)+'%"></i></div></div>').join("")+'</figure>'+
  '<nav aria-label="Five-day fleet"><a href="./fleetweek.html">Dispatch a week →</a><a href="./fleetweek.html#results">Read the results →</a><a href="./fleetweek.html#own-agent">Benchmark your agent →</a></nav></article>';
async function update(path,marker,body) {
  const file = new URL(path,root), html = await readFile(file,"utf8");
  const start='<!-- '+marker+'-start -->', end='<!-- '+marker+'-end -->';
  if (!html.includes(start)||!html.includes(end)) throw Error("Missing marker in "+path);
  const content=html.slice(0,html.indexOf(start)+start.length)+"\n"+body+"\n"+html.slice(html.indexOf(end));
  if (process.argv.includes("--check")) { if (html!==content) throw Error(path+" disagrees with the scored results."); }
  else await writeFile(file,content);
}
await update("fleetweek.html","fleet-results",results);
await update("studies.html","fleet-feature",feature);
