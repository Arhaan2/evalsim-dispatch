import { $, num, scrollTable, signed, table, text } from "./lib/freight-view.js";
import { dataRow } from "./lib/demand-desk.js";
import { interval, note, pairedDesk, verifyInWorker } from "./lib/paired-desk.js";
import { PAID_SUITE, PAID_PATTERNS, createPaid, observePaid, stepPaid, verifyPaid } from "./lib/paid.js";
import { paidReferenceFee, paidReferences, paidWeights } from "./lib/paid-benchmark.js";
import { paidDecision, paidPlannerDecision } from "./lib/paid-policy.js";

const names = { rl: "Paid survey agent", planner: "Survey-aware planner", rlNever: "Agent · never buy", rlAlways: "Agent · always buy",
  rlFree: "Agent · free survey", plannerNever: "Planner · never buy", plannerAlways: "Planner · always buy", plannerFree: "Planner · free survey",
  stochastic: "Original planner", booking: "Booking", survey: "Survey", rally: "Rally", trust: "Trust", drift: "Drift", turns: "Turns" };
const calls = { accept: "Book", pass: "Pass", buy: "Buy", skip: "Skip" };
const initialPrefix = ["pass", "pass", "accept", "pass", "pass"];
const { picker, reportGroups } = pairedDesk({ suite: PAID_SUITE, patterns: PAID_PATTERNS, names, compareKeys: ["rl","planner"],
  extraSplits: ["validation","retention","archive","surveyArchive"] });
let config, state, historyCalls, weights, release, refs, imported;

function details(label, ...children) {
  const section = document.createElement("details");
  section.append(text("summary",label), ...children);
  return section;
}
function grid(headers, caption, rows) {
  const element = table(headers,caption);
  const body = element.createTBody();
  for (const row of rows) dataRow(body,row);
  return scrollTable(element);
}
function link(label, settings, actions, hash) {
  const a = text("a",label);
  a.href = picker.url(settings, actions, hash);
  return a;
}
function group(s, key) {
  const [stratum, ending] = key.split("/");
  return stratum === "all" ? s.summary.all : s.summary.byStratumEnding[stratum][ending];
}
function readConfig(number, raw) {
  if (!/^\d{1,10}$/.test(raw) || Number(raw) > 0xffffffff) throw new Error("Enter a seed from 0 to 4294967295.");
  const seed = Number(raw), family = picker.decode(number, seed);
  if (!family) throw new Error("Choose a listed case.");
  return { family, seed };
}

function renderDesk() {
  const o = observePaid(state), survey = o.phase === "survey";
  $("wave").textContent = o.done ? "Shift complete" : survey ? "Before wave 6" : "Wave " + (o.wave + 1) + " of " + o.horizon;
  $("offer-heading").textContent = o.done ? "Final contribution" : survey ? "Fresh demand survey" : o.offer.lane + " load";
  $("net-offer").textContent = o.done ? o.net : survey ? o.surveyFee : o.offer.net;
  $("amount-label").textContent = o.done ? "net credits earned" : survey ? "credit to buy" : "net credits";
  $("offer-detail").textContent = o.done ? "All eight freight offers have closed."
    : survey ? "The reading counts high outcomes in six independent samples of wave-six demand. Buy or skip before the offer arrives."
    : o.offer.revenue + " freight revenue less " + o.offer.cost + " handling cost.";
  $("advice").hidden = !survey || !weights;
  if (survey && weights && $("advice").open) renderAdvice();
  $("received").hidden = o.reading == null;
  $("received-reading").textContent = o.reading == null ? "" : "Wave-six survey · " + o.reading + " of 6 samples were high.";
  $("reading-marks").replaceChildren(...Array.from({ length: o.reading == null ? 0 : 6 }, (_, i) => {
    const mark = document.createElement("span");
    if (i < o.reading) mark.className = "high";
    return mark;
  }));
  $("slot-count").textContent = o.slots + " of " + o.capacity + " slots open";
  $("slot-tiles").replaceChildren(...Array.from({ length: o.capacity }, (_,i) => {
    const mark = document.createElement("span");
    if (i < o.slots) mark.className = "open";
    return mark;
  }));
  $("accept").hidden = $("pass").hidden = o.done;
  $("accept").disabled = !survey && !o.slots;
  $("accept").textContent = survey ? "Buy survey · 1 credit" : "Book load";
  $("pass").textContent = survey ? "Skip survey" : "Pass";
  $("again").hidden = !o.done;
  $("reset").hidden = !historyCalls.length || o.done;
  const freight = historyCalls.filter(x => x === "accept" || x === "pass");
  const displayed = o.history.map(h => ({quote:h.quote,price:h.offer.net}));
  if (!o.done) displayed.push({quote:o.quote, price:o.offer?.net});
  displayed.push(...o.forecast.map(quote => ({quote})));
  $("forecast").replaceChildren();
  for (const [i,{quote,price}] of displayed.entries()) {
    dataRow($("forecast"),[i+1, quote.low+" / "+quote.high, num(100*quote.highChance)+"%", price ?? "Pending", calls[freight[i]] ?? "—"]);
  }
  $("current-score").textContent = o.gross + " freight credits − " + o.feePaid + " survey fee = " + o.net + " net";
  $("active-config").textContent = "Seed " + config.seed;
  const url = picker.url(config,historyCalls,location.hash);
  $("share").href = url;
  history.replaceState(null,"",url);
}

function start(settings, prefix = []) {
  const next = createPaid(settings);
  for (const id of prefix) stepPaid(next,id);
  config = settings;
  state = next;
  historyCalls = [...prefix];
  $("advice").open = false;
  $("live-estimates").replaceChildren();
  $("compare").open = false;
  $("comparison").replaceChildren();
  picker.select($("family"),config);
  $("seed").value = config.seed;
  renderDesk();
}
function act(primary) {
  const o = observePaid(state), id = o.phase === "survey" ? (primary ? "buy" : "skip") : (primary ? "accept" : "pass");
  const next = stepPaid(state,id);
  historyCalls.push(id);
  renderDesk();
  if ($("compare").open) compare();
  $("status").textContent = next.done ? "Shift complete. You earned " + next.net + " net credits."
    : id === "buy" ? $("received-reading").textContent + " The sixth offer pays " + next.offer.net + "."
    : next.phase === "survey" ? "Five offers completed. Choose whether to buy a fresh survey."
    : "Wave " + (next.wave+1) + ". The signed offer pays " + next.offer.net + " credits.";
  if (next.done) $("again").focus();
  else if ($("accept").disabled) $("pass").focus();
}

function replay(settings, decide, fee = 1) {
  const shift = createPaid({...settings,fee}), trace = [];
  while (!observePaid(shift).done) {
    const o = observePaid(shift), decision = decide(o, trace.length);
    trace.push({ phase:o.phase, action:decision, offer:o.offer?.net, slots:o.slots, reading:o.reading });
    stepPaid(shift,decision);
  }
  const score = verifyPaid(shift);
  if (score.violations.length) throw new Error("The shift ledger did not reconcile.");
  return { trace, score };
}
function money(value) { return num(value,2); }
function renderAdvice() {
  const o = observePaid(state);
  if (o.phase !== "survey" || !weights) return;
  const rows = [[names.rl, paidDecision(o,weights.paid)], [names.planner, paidPlannerDecision(o,weights.paid)]]
    .map(([label,d])=>[label,money(d.buyValue),money(d.skipValue),calls[d.action]]);
  $("live-estimates").replaceChildren(note("Estimated remaining net credits on your opening. Buying includes the one-credit fee."),
    grid(["Dispatcher","Buy","Skip","Call"],"Net value of buying and skipping before seeing the signal",rows));
}
function compare() {
  if (!weights) { $("comparison").replaceChildren(note("Loading the published checkpoints…")); return; }
  const candidates = [["rl",names.rl,replay(config,refs.rl)],["planner",names.planner,replay(config,refs.planner)]];
  const visitor = imported?.cases.find(c => c.family === config.family && c.seed === config.seed);
  if (visitor) candidates.push(["external","Submitted agent",replay(config,(_, i) => visitor.actions[i])]);
  const { family, seed } = config, p = PAID_PATTERNS[family], tail = [];
  const scores = candidates.map(([,label,r]) => [label,r.score.bought ? "Buy" : "Skip",r.score.reading == null ? "—" : r.score.reading+" / 6",r.score.gross,r.score.feePaid,r.score.net]);
  const actions = candidates[0][2].trace.map((x,i) => [x.phase === "survey" ? "Survey" : i<5 ? i+1 : i, x.offer ?? "—",
    ...candidates.map(([, ,r])=>calls[r.trace[i].action]),calls[historyCalls[i]] ?? "—"]);
  const decisions = candidates.slice(0,2).map(([id,label,r]) => {
    const s = createPaid(config);
    r.trace.slice(0,5).forEach(x=>stepPaid(s,x.action));
    const o = observePaid(s);
    const d = id === "rl" ? paidDecision(o,release.checkpoint.weights) : paidPlannerDecision(o,release.checkpoint.weights);
    const branches = ["buy","skip"].map(action => {
      const branch = structuredClone(s);
      stepPaid(branch,action);
      while (!branch.done) stepPaid(branch,refs[id](observePaid(branch)));
      return verifyPaid(branch).net-o.net;
    });
    return [label,o.slots,money(d.buyValue),money(d.skipValue),calls[d.action],...branches];
  });
  const feeState = createPaid(config);
  for (let i=0;i<5;i++) stepPaid(feeState,"pass");
  const reading = stepPaid(feeState,"buy").reading;
  const twin = p.stem + "-" + (p.ending==="hot" ? "cold" : "hot");
  if (PAID_PATTERNS[twin]) {
    const links = document.createElement("div"); links.className = "section-links";
    links.append(link("Play the "+PAID_PATTERNS[twin].ending+"-ending twin →",{family:twin,seed},[],"session"));
    tail.push(links);
  }
  const more = details("Inspect all reference ledgers");
  more.addEventListener("toggle", () => {
    if (!more.open || more.querySelector("table")) return;
    const rows = Object.entries(refs).map(([id,decide]) => {
      const {score} = replay(config,decide,paidReferenceFee(id));
      return [names[id],score.bought ? "Buy" : "Skip",score.gross,score.feePaid,score.net];
    });
    more.append(grid(["Policy","Call","Freight","Fee","Net"],"Replayed credits for all fifteen reference policies",rows));
  });
  $("comparison").replaceChildren(text("h3",p.label),note("The fresh survey sampled " + reading + " high outcomes out of six. Each policy started with two slots. A policy that skipped the survey played the remaining offers with its public history."),
    grid(["Dispatcher","Survey","Reading","Freight","Fee","Net"],"Freight contribution and survey fees",scores),
    text("h3","Value before the survey"),note("Each dispatcher estimates its remaining earnings just before the sixth offer. The buy estimate includes the one-credit fee."),
    note("The two replay columns show the remaining net credits when that dispatcher is forced to buy or skip on this tape."),
    grid(["Dispatcher","Open slots","Buy estimate","Skip estimate","Call","Buy replay","Skip replay"],"Expected and realized remaining net credits for each purchase decision",decisions),
    grid(["Wave","Signed offer",...candidates.map(x=>x[1]),"Your call"],"Every booking and survey call, in order",actions),more,...tail);
}

function forcedPurchasePair() {
  const hints = document.createElement("div"); hints.className = "section-links";
  const rows = [];
  for (const ending of ["cold","hot"]) {
    const settings = { family:"staggered-lift-"+ending, seed:15300271 };
    const prefix = [], shift = createPaid(settings);
    while (observePaid(shift).phase !== "survey") {
      const id = refs.rl(observePaid(shift)); prefix.push(id); stepPaid(shift,id);
    }
    const branch = id => replay(settings,(o,i) => i===5 ? id : refs.rl(o));
    const buy=branch("buy"), skip=branch("skip");
    rows.push([ending==="hot" ? "Hot" : "Cold",buy.score.reading+" / 6",calls[buy.trace[6].action],calls[skip.trace[6].action],
      buy.score.net,skip.score.net,signed(buy.score.net-skip.score.net)]);
    hints.append(link("Play the "+ending+" twin →",settings,prefix,"session"));
  }
  const section = document.createElement("section"); section.id="matched-surveys";
  section.append(text("h3","What if the agent had bought?"),
    note("These fresh twins give the agent identical information and one slot at the survey window. It skipped both times. When forced to buy, it received the same 2-of-6 reading and passed the same sixth offer. Later prices determined what waiting earned."),
    grid(["Ending","Sample","Wave 6 if bought","Wave 6 if skipped","Net if bought","Net if skipped","Difference"],"Matched staggered-lift shifts with the same opening and purchased signal at seed 15300271",rows),hints);
  return section;
}

function acquisitionEvidence(splits) {
  const contexts = [["Fresh hot drops","test","interrupted-drop/hot"],["Fresh cold reversals","test","reversal/cold"],["Original drop","retention","all"],["All fresh shifts","test","all"]];
  const rows = [];
  for (const [label,split,groupKey] of contexts) for (const id of ["rl","planner"]) {
    const a = splits[split].acquisition[groupKey][id], skips = a.shifts-a.bought;
    rows.push([label,id === "rl" ? "Agent" : "Planner",num(a.bought)+" / "+num(a.shifts),a.bought ? signed(a.buyGain/a.bought) : "—",
      skips ? signed(a.skipGain/skips) : "—"]);
  }
  const links = document.createElement("div"); links.className = "example-links";
  for (const bought of [true,false]) {
    for (const row of splits.test.cases) {
      if (Boolean(row.bought[0]) !== bought) continue;
      const test = createPaid(row), prefix = [];
      while (observePaid(test).phase !== "survey") {
        const id = refs.rl(observePaid(test)); prefix.push(id); stepPaid(test,id);
      }
      if (!observePaid(test).slots) continue;
      links.append(link(bought ? "Play a shift where the agent bought →" : "Play a shift where the agent skipped →",row,prefix,"session"));
      break;
    }
  }
  const all = splits.test.summary.all.references;
  const refKeys = Object.keys(all);
  const buys = key => splits.test.cases.filter(row=>row.bought[refKeys.indexOf(key)]).length;
  const usage = grid(["Dispatcher","Bought at 1 credit","Requested at zero fee","Fresh shifts"],"Survey take-up when optional at each posted price",
    [[names.rl,num(buys("rl")),num(buys("rlFree")),num(splits.test.cases.length)], [names.planner,num(buys("planner")),num(buys("plannerFree")),num(splits.test.cases.length)]]);
  const selective = text("p","On all fresh shifts, the optional agent earned " + interval(all.rlNever) + " credits per shift versus never buying and " + interval(all.rlAlways) + " versus always buying. Brackets show paired 95% intervals.");
  $("acquisition").replaceChildren(usage,selective,note("At each dispatcher’s own survey window we replayed buying and skipping on the same shift, then let it finish both branches. Positive differences mean the purchase earned back its fee."),
    grid(["Market","Policy","Bought / shifts","Buy minus skip when bought","Buy minus skip when skipped"],"Realized value per purchase or declined purchase in net credits",rows), links,forcedPurchasePair());
}
function evidence(r) {
  const s = r.splits, c = r.checks;
  const targets = [["Fresh hot drops",group(s.test,"interrupted-drop/hot"),c.hotDrops],["Fresh cold reversals",group(s.test,"reversal/cold"),c.coldReversals],
    ["Original interrupted drop",s.retention.summary.all,c.originalDrop],["Booking cold reversals · new draws",group(s.archive,"reversal/cold"),c.archiveColdReversals],
    ["Survey cold reversals · new draws",group(s.surveyArchive,"reversal/cold"),c.surveyArchiveColdReversals]];
  const controls = [["All fresh shifts",s.test.summary.all],...targets.map(([label,g])=>[label,g])].map(([label,g])=>
    [label,...["rl","rlNever","rlAlways","rlFree","planner","plannerNever","plannerAlways","plannerFree"].map(k=>money(g.references[k].mean))]);
  const coldRows = targets.filter(([label]) => label.includes("cold reversals")).map(([label,g]) => [label,interval(g.references.planner),interval(g.references.booking),interval(g.references.survey)]);
  const orig = s.retention.summary.all.references;
  const past = ["planner","stochastic","survey","booking","rally","trust","drift","turns"].map(k=>{
    const margin = ["rally","trust","drift","turns"].includes(k) ? -1 : 0;
    return [names[k],interval(orig[k]),"Above "+margin,orig[k].interval95[0]>margin ? "Passed" : "Missed"];
  });
  const fresh = s.test.acquisition.all;
  const neitherBought = fresh.rl.bought===0 && fresh.planner.bought===0;
  const resultTitle = neitherBought ? "Both dispatchers skipped every paid survey" : c.joint ? "All targets passed" : "The joint target was missed";
  const opening = neitherBought ? "Across " + num(fresh.rl.shifts) + " fresh shifts, both optional policies kept the one credit every time. Their score differences came from freight bookings." : "";
  $("scorecard").replaceChildren(text("h3", resultTitle), note(opening + (c.joint ? " The joint target passed." : " The joint target was missed.")),
    note("Differences are mean net credits per shift relative to the survey-aware planner, with paired 95% intervals over seeds. Positive values favor the trained agent."),
    grid(["Market","Shifts","Agent net","Planner net","Difference [95%]","Target"],"All prespecified tests using fee-adjusted net credits",
      targets.map(([label,g,passed])=>[label,num(g.shifts),money(g.mean),money(g.references.planner.mean),interval(g.references.planner),passed ? "Passed" : "Missed"])),
    note("Each cold test requires beating the survey-aware planner and staying within one credit of Booking and Survey. The original drop has separate recovery thresholds."),
    details("Inspect the cold-reversal thresholds",grid(["Market","Versus survey-aware planner","Versus Booking","Versus Survey"],"Cold-reversal margins in credits with paired 95% intervals",coldRows)),
    details("Inspect the original recovery thresholds",grid(["Reference","Difference [95%]","Lower bound","Target"],"Historical retention and improvement requirements",past)),
    details("Compare paid, forced and free surveys",note("Optional, never-buy and always-buy policies use the same one-credit price. The free comparison offers the same signal at zero cost. Each policy starts its own shift."),
    grid(["Market","Agent","Never","Always","Free","Planner","Never","Always","Free"],"Mean net credits for both policies under four acquisition rules",controls)));
  acquisitionEvidence(s);
}
function reportView(report) {
  const refs = report.summary.all.references;
  const rows = Object.entries(refs).map(([k,a])=>[names[k]??k,money(a.mean),interval(a)]);
  const inspect = text("button","Replay the first submitted shift"); inspect.type = "button";
  inspect.onclick = () => {
    start(report.cases[0]); $("compare").open = true; compare(); $("compare").querySelector("summary").focus();
  };
  $("report-result").replaceChildren(note("Your agent averaged " + money(report.summary.all.mean) + " net credits per shift."),
    details("Compare all reference scores",grid(["Reference","Net credits","Your difference [95%]"],"Submitted agent versus the public reference policies",rows)),
    reportGroups(report.summary.byStratum,report.summary),inspect);
}
async function upload(file) {
  imported = null;
  $("report-result").replaceChildren();
  if ($("compare").open) compare();
  if (!file) { $("report-status").textContent = ""; return; }
  $("report-file").disabled = true;
  $("report-status").textContent = "Replaying your decisions and checking fees…";
  try {
    const report = JSON.parse(await file.text());
    await verifyInWorker(new URL("./lib/paid-report-worker.js",import.meta.url), report, weights);
    imported = report;
    reportView(report);
    $("report-status").textContent = report.policy + " verified on " + num(report.cases.length) + " " + report.split + " shifts.";
    if ($("compare").open) compare();
  } catch (err) { $("report-status").textContent = "Could not verify the report. " + err.message; }
  finally { $("report-file").disabled = false; $("report-file").value = ""; }
}
async function loadStudy() {
  try {
    const data = await Promise.all(["paid","booking","survey","rally","trust","closes","drift","turns"].map(async lab => {
      const response = await fetch("./data/"+lab+"/results.json");
      if (!response.ok) throw new Error("Could not load the "+lab+" checkpoint.");
      return response.json();
    }));
    release = data[0];
    weights = paidWeights(...data);
    refs = paidReferences(weights);
    evidence(release);
    renderDesk();
    $("upload").hidden = false;
    $("load-status").textContent = "";
    if ($("compare").open) compare();
  } catch (err) { $("load-status").textContent = "The study could not load. " + err.message + " Reload, or run the tagged benchmark locally."; }
}
function init() {
  const params = new URL(location.href).searchParams;
  const hash = location.hash;
  try {
    const settings = readConfig(params.get("case") ?? "1",params.get("seed") ?? String(picker.initialSeed()));
    const prefix = params.has("actions") ? params.get("actions").split(",") : params.has("case") ? [] : initialPrefix;
    if (prefix.length>9) throw new Error("Invalid replay.");
    start(settings,prefix);
    if (!params.has("case") && !params.has("actions")) $("status").textContent = "Five offers have played. The third load is booked. Start at wave one to choose the opening yourself.";
  } catch {
    start({family:PAID_SUITE.splits.test.families[0],seed:PAID_SUITE.splits.test.start},initialPrefix);
    $("status").textContent = "This run link was invalid. A new shift is open at the survey window.";
  }
  $("accept").onclick = () => act(true);
  $("pass").onclick = () => act(false);
  for (const id of ["reset","again"]) $(id).onclick = () => { start(config); $("status").textContent = "Restarted the same shift."; $("offer-heading").focus(); };
  $("case-form").onsubmit = event => {
    event.preventDefault();
    try { start(readConfig($("family").value,$("seed").value)); $("config").open = false; $("offer-heading").focus(); $("status").textContent = "Loaded a new shift."; }
    catch (err) { $("status").textContent = err.message; }
  };
  $("advice").addEventListener("toggle", () => { if ($("advice").open) renderAdvice(); });
  $("compare").addEventListener("toggle",() => { if ($("compare").open) compare(); });
  $("report-file").onchange = event => upload(event.target.files[0]);
  $("session").hidden = false;
  if (hash === "#compare") $("compare").open = true;
  loadStudy();
}
init();
