import {createFleetWeek, runFleetWeek, FLEET_DEPOTS, FLEET_FAMILIES} from "./lib/fleetweek.js";
import {fleetReferences} from "./lib/fleetweek-benchmark.js";
import {FLEET_SPLITS} from "./lib/fleetweek-study.js";

const byId = id => document.getElementById(id);
const days = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
const num = n => new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(n);
const round = epoch => days[Math.floor(epoch/2)] + (epoch%2 ? " afternoon" : " morning");
const load = code => ({C:"Contract",S0:"Spot A",S1:"Spot B"})[code];
let world, config, refs, release, submitted, verifier;
const journey = [];
let comparison = false;
const tables = (target, rows) => {
  byId(target).replaceChildren(...rows.map(cells => {
    const row = document.createElement("tr");
    for (const value of cells) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    return row;
  }));
};
function moveLabel(code, obs) {
  if (code === "W") return "Wait";
  if (code[0] === "E") return "Move empty to " + FLEET_DEPOTS[Number(code[1])];
  const item = obs.orders.find(x=>x.id === code);
  return load(code) + " to " + FLEET_DEPOTS[item.destination];
}
function options(id, codes, obs, previous) {
  const select = byId(id);
  select.replaceChildren(...[...new Set(codes)].map(code => new Option(moveLabel(code,obs),code)));
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
function updateSecond() {
  const actions = world.legalActions().filter(a => a.moves[0] === byId("first").value);
  options("second",actions.map(a=>a.moves[1]),world.observe(),byId("second").value);
  preview();
}
function selectedAction() {
  return world.legalActions().find(a => a.moves[0] === byId("first").value && a.moves[1] === byId("second").value);
}
function preview() {
  const a = selectedAction();
  byId("preview").textContent = "This round earns " + num(a.net) + " net credits. " +
    (a.served ? "Contract covered." : "Includes a 34-credit missed-contract penalty.");
}
function render() {
  const ledger = world.ledger;
  byId("week-balance").textContent = num(ledger.net) + " net credits · " + (ledger.contracts ?
    ledger.served + " of " + ledger.contracts + " contracts served" : "10 contracts due this week");
  byId("round-label").textContent = world.done ? "Five days dispatched" : "Round " + (ledger.contracts + 1) + " of 10";
  byId("live").hidden = world.done;
  byId("finished").hidden = !world.done;
  byId("log").hidden = journey.length === 0;
  byId("turns").replaceChildren(...journey.map(text => {const li=document.createElement("li");li.textContent=text;return li;}));
  if (world.done) {
    byId("round").textContent = "Week complete";
    const scores = [["Your dispatch",ledger], ...Object.entries(refs).map(([name,decide]) =>
      [({rl:"Trained RL",planner:"Planner",greedy:"Greedy"})[name],runFleetWeek(config,decide).ledger])];
    tables("finish-rows",(comparison ? scores.slice(1) : scores).map(([name,s])=>[name,num(s.net),s.served + " / 10",s.emptyMiles]));
    const traces = [refs.rl,refs.planner].map(fn=>runFleetWeek(config,fn).trace);
    const show = t => t.action.moves.map(code=>moveLabel(code,t.observation)).join(" / ") + " (" + num(t.action.net) + ")";
    tables("paired-rows", traces[0].map((t,i)=>[round(i),show(t),show(traces[1][i])]));
    byId("paired").hidden = false;
    return;
  }
  const obs = world.observe();
  byId("round").textContent = round(obs.epoch);
  tables("freight",obs.orders.map(o=>[load(o.id),FLEET_DEPOTS[o.origin]+" → "+FLEET_DEPOTS[o.destination],num(o.revenue),num(o.loadedCost)]));
  tables("forecast",obs.forecast.map((probs,i)=>[round(i),...probs.map(p=>Math.round(100*p)+"%")]));
  byId("outlook").textContent = "Current freight hub: " + FLEET_DEPOTS[obs.hub] + ".";
  byId("first-label").textContent = "Truck 1 at " + FLEET_DEPOTS[obs.positions[0]];
  byId("second-label").textContent = "Truck 2 at " + FLEET_DEPOTS[obs.positions[1]];
  options("first",world.legalActions().map(a=>a.moves[0]),obs,"W");
  byId("second").replaceChildren();
  updateSecond();
}
function reset(next) {
  comparison = false;
  byId("paired").hidden = true;
  config = next;
  world = createFleetWeek(config);
  journey.length = 0;
  byId("confirmation").textContent = "";
  byId("log").open = false;
  const url = new URL(location.href);
  url.search = new URLSearchParams({family:config.family,seed:String(config.seed)}).toString();
  url.hash = "play";
  byId("share").href = url.href;
  render();
}
function dispatch(id) {
  const obs = world.observe(), {action,ledger} = world.step(id);
  const line = round(obs.epoch) + " · " + action.moves.map((code,i)=>"Truck "+(i+1)+": "+moveLabel(code,obs)).join("; ") +
    ". Round net " + num(action.net) + "; week net " + num(ledger.net) + ".";
  journey.push(line);
}
byId("actions").onsubmit = e => {
  e.preventDefault();
  if (!world || world.done) return;
  dispatch(selectedAction().id);
  render();
  byId("round").focus({preventScroll:true});
  byId("confirmation").textContent = journey.at(-1);
};
byId("first").onchange = updateSecond;
byId("second").onchange = preview;
byId("restart").onclick = () => {reset(config);byId("round").focus();};
byId("another").onclick = () => {
  const list = FLEET_FAMILIES.test;
  reset({family:list[(list.indexOf(config.family)+1)%list.length],seed:(config.seed+1)>>>0});
  byId("round").focus();
};
async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw Error("Could not load published fleet data.");
  return r.json();
}
async function start() {
  release = await json("./data/fleetweek/results.json");
  refs = fleetReferences(await json("./data/fleetweek/model-" + release.primarySeed + ".json"));
  const q = new URLSearchParams(location.search), family=q.get("family"), seed=q.get("seed");
  const valid = Object.values(FLEET_FAMILIES).flat().includes(family) && /^\d{1,10}$/.test(seed) && Number(seed)<=0xffffffff;
  reset(valid ? {family,seed:Number(seed)} : {family:FLEET_FAMILIES.validation[0],seed:20261125});
  if (valid && q.get("mode") === "compare") {
    comparison = true;
    for (const id of runFleetWeek(config,refs.rl).actions) dispatch(id);
    render();
    byId("confirmation").textContent = "Both dispatchers saw the same offers. Restart to play this week yourself.";
  }
  if ((q.has("seed") || q.has("family")) && !valid) byId("confirmation").textContent = "This week link was invalid. Opened the practice week.";
  byId("desk-loading").hidden = true;
  byId("week-controls").hidden = false;
  byId("report").disabled = false;
}
byId("report").disabled = true;
start().catch(e => {byId("desk-loading").textContent=e.message;});
let generation = 0;
byId("report").onchange = async e => {
  const run = ++generation, file=e.target.files[0];
  verifier?.terminate(); verifier=null; submitted=null;
  byId("checked").hidden = true;
  byId("verification").textContent = "";
  if (!file) return;
  try {
    if (file.size > 12*1024*1024) throw Error("Report exceeds 12 MB.");
    byId("verification").textContent = "Replaying every decision and checking the ledger…";
    const report = JSON.parse(await file.text());
    if (run !== generation) return;
    if (!FLEET_SPLITS.includes(report?.split)) throw Error("Unknown evaluation split.");
    const worker = new Worker(new URL("./lib/fleetweek-report-worker.js",import.meta.url),{type:"module"});
    verifier = worker;
    worker.onerror = () => {
      worker.terminate();
      if (run === generation) byId("verification").textContent = "Could not verify the report. Try again.";
    };
    worker.onmessage = ({data}) => {
      worker.terminate();
      if (run !== generation) return;
      if (data.error) {byId("verification").textContent="Could not verify: "+data.error;return;}
      submitted = report;
      const result = report.summary.all, delta = result.comparisons.planner;
      byId("verification").textContent = "Verified " + report.cases.length.toLocaleString("en-US") + " " + report.split + " weeks for " + report.policy + ".";
      byId("report-score").textContent = num(result.policies.agent.net) + " net credits per week · " +
        num(result.policies.agent.onTime) + "% on time · " + num(delta.net) + " credits versus planner (95% interval " + delta.net95.map(num).join(" to ") + ").";
      byId("case-number").max = report.cases.length;
      byId("case-number").value = 1;
      byId("checked").hidden = false;
    };
    worker.postMessage({report,digest:release.banks[report.split]});
  } catch(err) { if(run===generation) byId("verification").textContent="Could not verify: "+err.message; }
};
byId("replay").onclick = () => {
  const input=byId("case-number"), row=submitted?.cases[input.valueAsNumber-1];
  if (!row || !input.reportValidity()) return;
  reset({family:row.family,seed:row.seed});
  for (const id of row.actions) dispatch(id);
  render(); byId("log").open=true; byId("round").focus();
};
