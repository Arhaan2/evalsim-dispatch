import { $, num, scrollTable, signed, table, text } from "./lib/freight-view.js";
import { dataRow } from "./lib/demand-desk.js";
import { interval, note, pairedDesk, verifyInWorker } from "./lib/paired-desk.js";
import { TARIFF_SUITE, TARIFF_PATTERNS, PRICE_CENTS, createTariff, observeTariff, stepTariff, verifyTariff } from "./lib/tariff.js";
import { tariffReferences } from "./lib/tariff-benchmark.js";
import { tariffDecision, tariffPlannerDecision } from "./lib/tariff-policy.js";

const names = { rl: "Price-trained agent", planner: "Survey-aware planner", rlNever: "Agent · never buy", rlAlways: "Agent · always buy",
  plannerNever: "Planner · never buy", plannerAlways: "Planner · always buy", paid: "Previous one-credit agent",
  stochastic: "Original planner", booking: "Booking", survey: "Survey", rally: "Rally", trust: "Trust", drift: "Drift", turns: "Turns" };
const calls = { accept: "Book", pass: "Pass", buy: "Buy", skip: "Skip" };
const initialPrefix = ["pass", "pass", "accept", "pass", "pass"];
const { picker, reportGroups } = pairedDesk({ suite: TARIFF_SUITE, patterns: TARIFF_PATTERNS, names, compareKeys: ["rl","planner"],
  extraSplits: ["validation","retention","archive"] });
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
const priceLabel = cents => (cents / 100).toFixed(2);
function shiftUrl(settings, actions, hash) {
  const url = picker.url(settings,actions,hash);
  url.searchParams.set("priceCents",String(settings.priceCents));
  return url;
}
function link(label, settings, actions, hash) {
  const a = text("a",label);
  a.href = shiftUrl(settings, actions, hash);
  return a;
}
function group(s, key) {
  const [stratum, ending] = key.split("/");
  return stratum === "all" ? s.summary.all : s.summary.byStratumEnding[stratum][ending];
}
function readConfig(number, raw, price) {
  if (!/^\d{1,10}$/.test(raw) || Number(raw) > 0xffffffff) throw new Error("Enter a seed from 0 to 4294967295.");
  const seed = Number(raw), family = picker.decode(number, seed);
  if (!family) throw new Error("Choose a listed case.");
  if (!/^\d{1,3}$/.test(price) || Number(price) > 100) throw new Error("Enter a survey price from 0 to 100 cents.");
  return { family, seed, priceCents:Number(price) };
}

function renderDesk() {
  const o = observeTariff(state), survey = o.phase === "survey";
  $("wave").textContent = o.done ? "Shift complete" : survey ? "Before wave 6" : "Wave " + (o.wave + 1) + " of " + o.horizon;
  $("offer-heading").textContent = o.done ? "Final contribution" : survey ? "Fresh demand survey" : o.offer.lane + " load";
  $("net-offer").textContent = o.done ? o.net : survey ? priceLabel(config.priceCents) : o.offer.net;
  $("amount-label").textContent = o.done ? "net credits earned" : survey ? "credits to buy" : "net credits";
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
  $("accept").textContent = survey ? (config.priceCents ? "Buy survey · "+priceLabel(config.priceCents) : "Get free survey") : "Book load";
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
  $("active-config").textContent = "Price " + priceLabel(config.priceCents) + " · Seed " + config.seed;
  const url = shiftUrl(config,historyCalls,location.hash);
  $("share").href = url;
  history.replaceState(null,"",url);
}

function start(settings, prefix = []) {
  const next = createTariff(settings);
  for (const id of prefix) stepTariff(next,id);
  config = settings;
  state = next;
  historyCalls = [...prefix];
  $("advice").open = false;
  $("live-estimates").replaceChildren();
  $("compare").open = false;
  $("comparison").replaceChildren();
  picker.select($("family"),config);
  $("seed").value = config.seed;
  $("price").value = config.priceCents;
  updatePriceLabel();
  renderDesk();
}
function act(primary) {
  const o = observeTariff(state), id = o.phase === "survey" ? (primary ? "buy" : "skip") : (primary ? "accept" : "pass");
  const next = stepTariff(state,id);
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

function replay(settings, decide) {
  const shift = createTariff(settings), trace = [];
  while (!observeTariff(shift).done) {
    const o = observeTariff(shift), decision = decide(o, trace.length);
    trace.push({ phase:o.phase, action:decision, offer:o.offer?.net, slots:o.slots, reading:o.reading });
    stepTariff(shift,decision);
  }
  const score = verifyTariff(shift);
  if (score.violations.length) throw new Error("The shift ledger did not reconcile.");
  return { trace, score };
}
function money(value) { return num(value,2); }
function renderAdvice() {
  const o = observeTariff(state);
  if (o.phase !== "survey" || !weights) return;
  const rows = [[names.rl, tariffDecision(o,weights.tariff)], [names.planner, tariffPlannerDecision(o,weights.tariff)]]
    .map(([label,d])=>[label,money(d.buyValue),money(d.skipValue),calls[d.action]]);
  $("live-estimates").replaceChildren(note("Estimated remaining net credits on your opening. Buying includes the posted survey fee."),
    grid(["Dispatcher","Buy","Skip","Call"],"Net value of buying and skipping before seeing the signal",rows));
}
function compare() {
  if (!weights) { $("comparison").replaceChildren(note("Loading the published checkpoints…")); return; }
  const candidates = [["rl",names.rl,replay(config,refs.rl)],["planner",names.planner,replay(config,refs.planner)]];
  const visitor = imported?.cases.find(c => c.family === config.family && c.seed === config.seed && c.priceCents === config.priceCents);
  if (visitor) candidates.push(["external","Submitted agent",replay(config,(_, i) => visitor.actions[i])]);
  const { family, seed } = config, p = TARIFF_PATTERNS[family], tail = [];
  const scores = candidates.map(([,label,r]) => [label,r.score.bought ? "Buy" : "Skip",r.score.reading == null ? "—" : r.score.reading+" / 6",r.score.gross,r.score.feePaid,r.score.net]);
  const actions = candidates[0][2].trace.map((x,i) => [x.phase === "survey" ? "Survey" : i<5 ? i+1 : i, x.offer ?? "—",
    ...candidates.map(([, ,r])=>calls[r.trace[i].action]),calls[historyCalls[i]] ?? "—"]);
  const decisions = candidates.slice(0,2).map(([id,label,r]) => {
    const s = createTariff(config);
    r.trace.slice(0,5).forEach(x=>stepTariff(s,x.action));
    const o = observeTariff(s);
    const d = id === "rl" ? tariffDecision(o,weights.tariff) : tariffPlannerDecision(o,weights.tariff);
    const branches = ["buy","skip"].map(action => {
      const branch = structuredClone(s);
      stepTariff(branch,action);
      while (!branch.done) stepTariff(branch,refs[id](observeTariff(branch)));
      return (verifyTariff(branch).netCents-o.netCents)/100;
    });
    return [label,o.slots,money(d.buyValue),money(d.skipValue),calls[d.action],...branches];
  });
  const feeState = createTariff(config);
  for (let i=0;i<5;i++) stepTariff(feeState,"pass");
  const reading = stepTariff(feeState,"buy").reading;
  const twin = p.stem + "-" + (p.ending==="hot" ? "cold" : "hot");
  if (TARIFF_PATTERNS[twin]) {
    const links = document.createElement("div"); links.className = "section-links";
    links.append(link("Play the "+TARIFF_PATTERNS[twin].ending+"-ending twin →",{family:twin,seed,priceCents:config.priceCents},[],"session"));
    tail.push(links);
  }
  const more = details("Inspect all reference ledgers");
  more.addEventListener("toggle", () => {
    if (!more.open || more.querySelector("table")) return;
    const rows = Object.entries(refs).map(([id,decide]) => {
      const {score} = replay(config,decide);
      return [names[id],score.bought ? "Buy" : "Skip",score.gross,score.feePaid,score.net];
    });
    more.append(grid(["Policy","Call","Freight","Fee","Net"],"Replayed credits for all public reference policies",rows));
  });
  $("comparison").replaceChildren(text("h3",p.label),note("The fresh survey sampled " + reading + " high outcomes out of six. Each policy started with two slots. A policy that skipped the survey played the remaining offers with its public history."),
    grid(["Dispatcher","Survey","Reading","Freight","Fee","Net"],"Freight contribution and survey fees",scores),
    text("h3","Value before the survey"),note("Each dispatcher estimates its remaining earnings just before the sixth offer. The buy estimate includes the posted fee."),
    note("The two replay columns show the remaining net credits when that dispatcher is forced to buy or skip on this tape."),
    grid(["Dispatcher","Open slots","Buy estimate","Skip estimate","Call","Buy replay","Skip replay"],"Expected and realized remaining net credits for each purchase decision",decisions),
    grid(["Wave","Signed offer",...candidates.map(x=>x[1]),"Your call"],"Every booking and survey call, in order",actions),more,...tail);
}

const markets = [
  ["All fresh shifts","test","all"], ["Fresh hot drops","test","interrupted-drop/hot"],
  ["Fresh cold reversals","test","reversal/cold"], ["Original interrupted drop","retention","all"],
  ["Previous hot drops","archive","interrupted-drop/hot"], ["Previous cold reversals","archive","reversal/cold"],
];

function fromSummary(summary, key) {
  const [stratum,ending] = key.split("/");
  return key === "all" ? summary.all : summary.byStratumEnding[stratum][ending];
}
function drawPriceCurve(split, key, target) {
  const chart = document.createElement("div");
  chart.className = "buy-chart";
  chart.setAttribute("aria-hidden","true");
  for (const label of ["Price","Agent buys","Planner buys"]) chart.append(text("strong",label));
  const rows = [], gains = [];
  const prices = PRICE_CENTS.map(cents => fromSummary(split.summary.byPrice[cents],key));
  const scale = Math.max(1, ...prices.flatMap(g => [g.references.rl,g.references.planner].map(r=>100*r.bought/g.shifts)));
  for (const [i,cents] of PRICE_CENTS.entries()) {
    const g = prices[i], agent = g.references.rl, planner = g.references.planner;
    const rates = [agent,planner].map(x => 100*x.bought/g.shifts);
    chart.append(text("span",priceLabel(cents)));
    for (const [j,rate] of rates.entries()) {
      const cell = document.createElement("span"), rail = document.createElement("span"), bar = document.createElement("i");
      cell.className = j ? "bar planner" : "bar";
      bar.style.setProperty("--length", (100*rate/scale) + "%");
      rail.append(bar); cell.append(rail,text("span",num(rate,1)+"%")); chart.append(cell);
    }
    for (const id of ["rl","planner"]) {
      const a = split.acquisition[key][cents][id], skips = a.shifts - a.bought;
      gains.push([priceLabel(cents), names[id], num(a.bought), a.bought ? signed(a.buyGainCents / (100 * a.bought)) : "—",
        num(skips), skips ? signed(a.skipGainCents / (100 * skips)) : "—"]);
    }
    rows.push([priceLabel(cents),num(g.shifts),num(agent.bought),num(planner.bought),money(agent.mean),money(planner.mean),
      interval(planner),money(agent.fees),money(planner.fees)]);
  }
  target.replaceChildren(chart,grid(["Price","Shifts","Agent buys","Planner buys","Agent net","Planner net","Difference [95%]","Agent fees paid","Planner fees paid"],
    "Survey purchases, total fees and mean net earnings by price for the selected market",rows),
    details("What did buying change?",note("On each reached survey window, replay both choices with the same later offers. Positive values mean buying earned back the fee. A dash means the policy reached no windows in that group."),
      grid(["Price","Dispatcher","Bought","Buy minus skip when bought","Skipped","Buy minus skip when skipped"],"Mean realized purchase advantage on the selected and declined windows",gains)));
}
function priceExample() {
  const section = document.createElement("section"); section.id = "price-example";
  const rows = [], links = document.createElement("div"); links.className = "section-links";
  for (const priceCents of [5,10]) {
    const config = {family:"step-rebound-hot",seed:16300086,priceCents}, state = createTariff(config), prefix = [];
    while (observeTariff(state).phase !== "survey") {
      const action = refs.rl(observeTariff(state));
      prefix.push(action); stepTariff(state,action);
    }
    const d = tariffDecision(observeTariff(state),weights.tariff), { score } = replay(config,refs.rl);
    rows.push([priceLabel(priceCents),money(d.buyValue),money(d.skipValue),calls[d.action],
      score.bought ? score.reading + " / 6" : "—",score.gross,money(score.feePaid),money(score.net)]);
    links.append(link("Play at "+priceLabel(priceCents)+" credits →",config,prefix,"session"));
  }
  section.append(text("h3","The same shift at two prices"),
    note("On this hot-ending shift the agent reaches the survey window with one slot left and puts the reading’s expected freight value at 0.071 credits. The posted prices straddle that estimate. The last three columns show the realized ledger."),
    grid(["Price","Estimated buy","Estimated skip","Agent call","Reading","Freight","Fee","Net"],"Matched survey gate on step-rebound-hot seed 16300086 at two prices",rows),links);
  return section;
}

function acquisitionEvidence(splits) {
  const section = document.createElement("div"); section.id = "price-curve";
  const select = document.createElement("select"), label = document.createElement("label");
  label.className = "market-filter"; label.append("Market",select);
  for (const [index,m] of markets.entries()) select.add(new Option(m[0],String(index)));
  const panel = document.createElement("div"); section.append(label,panel);
  function changeMarket() {
    const [,split,key] = markets[Number(select.value)];
    drawPriceCurve(splits[split],key,panel);
  }
  changeMarket();
  select.onchange = changeMarket;
  const group = splits.test.summary.positive;
  const refs = group.references;
  const controls = ["rl","rlNever","rlAlways","planner","plannerNever","plannerAlways","paid"].map(k=>[
    names[k], num(refs[k].bought),money(refs[k].fees),money(refs[k].mean),interval(refs[k])]);
  const positive = details("Compare policies at positive prices",note("Each forced policy follows its optional dispatcher until the survey window, then always buys or always skips. The previous one-credit agent also sees the posted price."),
    grid(["Policy","Purchases","Fees paid","Mean net","Agent minus policy [95%]"],"Policies on all fresh shifts with a positive posted survey fee",controls));
  $("acquisition").replaceChildren(note("Purchase rates use all shifts at the selected price, including shifts where both slots were already booked. The same freight and potential survey reading are replayed at every price."),
    section,
    note("Across " + num(group.shifts) + " fresh shifts with a positive price, the agent bought " + num(refs.rl.bought)
      + " readings and earned " + refs.rlNever.delta.toFixed(3) + " more credits per shift than always skipping (paired 95% interval "
      + refs.rlNever.interval95.map(x => x.toFixed(3)).join(" to ") + "). The difference versus always buying was " + interval(refs.rlAlways) + "."),
    positive,priceExample());
}
function evidence(r) {
  const { splits:s,checks:c } = r;
  const targets = [["Fresh hot drops",group(s.test,"interrupted-drop/hot"),c.hotDrops],
    ["Fresh cold reversals",group(s.test,"reversal/cold"),c.coldReversals],["Original interrupted drop",s.retention.summary.all,c.originalDrop]];
  const row = ([label,g,pass]) => [label,num(g.tapes),num(g.shifts),money(g.mean),money(g.references.planner.mean),interval(g.references.planner),pass ? "Passed" : "Missed"];
  const pastRefs = s.retention.summary.all.references;
  const history = ["stochastic","booking","survey","paid","rally","trust","drift","turns"].map(k => {
    const margin = ["stochastic","booking","survey"].includes(k) ? 0 : -1;
    return [names[k],interval(pastRefs[k]),"Above "+margin,pastRefs[k].interval95[0]>margin ? "Passed" : "Missed"];
  });
  const previous = markets.slice(-2).map(([label,split,key]) => {
    const g=group(s[split],key);
    return [label,num(g.tapes),money(g.mean),money(g.references.planner.mean),interval(g.references.planner)];
  });
  $("scorecard").replaceChildren(text("h3", c.joint ? "All three targets passed" : "The joint target was missed"),
    note("Each difference is the agent’s mean net credits per shift minus the survey-aware planner’s. The seven prices have equal weight. Paired 95% intervals resample seeds and keep each tape and its prices together."),
    grid(["Market","Freight tapes","Priced shifts","Agent net","Planner net","Difference [95%]","Target"],
      "Prespecified fresh-market and historical retention tests after survey fees",targets.map(row)),
    note("A fresh-market win requires the interval’s lower bound to exceed zero. The original-drop target compares the agent with eight earlier references."),
    details("Check the original interrupted-drop gains",grid(["Reference","Agent minus reference [95%]","Lower bound","Target"],
      "Net credit margins on the original interrupted drop",history)),
    details("Check the previous Paid markets on new seeds",grid(["Market","Freight tapes","Agent net","Planner net","Difference [95%]"],
      "Archived Paid patterns replayed on fresh freight draws at the seven prices",previous)));
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
    await verifyInWorker(new URL("./lib/tariff-report-worker.js",import.meta.url), report, weights);
    imported = report;
    reportView(report);
    $("report-status").textContent = report.policy + " verified on " + num(report.cases.length) + " " + report.split + " shifts.";
    if ($("compare").open) compare();
  } catch (err) { $("report-status").textContent = "Could not verify the report. " + err.message; }
  finally { $("report-file").disabled = false; $("report-file").value = ""; }
}
async function loadStudy() {
  try {
    const response = await fetch("./data/tariff/desk.json");
    if (!response.ok) throw new Error("Could not load the public checkpoint.");
    release = await response.json();
    weights = release.weights;
    refs = tariffReferences(weights);
    evidence(release);
    renderDesk();
    $("upload").hidden = false;
    $("load-status").textContent = "";
    if ($("compare").open) compare();
  } catch (err) { $("load-status").textContent = "The study could not load. " + err.message + " Reload, or run the tagged benchmark locally."; }
}
function updatePriceLabel() {
  const cents = Number($("price").value);
  $("price-label").value = priceLabel(cents);
  $("price").setAttribute("aria-valuetext", priceLabel(cents) + " credits");
  $("apply-price").disabled = cents === config.priceCents;
}
function init() {
  const params = new URL(location.href).searchParams;
  const hash = location.hash;
  try {
    const settings = readConfig(params.get("case") ?? "1",params.get("seed") ?? String(picker.initialSeed()),params.get("priceCents") ?? "10");
    const prefix = params.has("actions") ? params.get("actions").split(",") : params.has("case") ? [] : initialPrefix;
    if (prefix.length>9) throw new Error("Invalid replay.");
    start(settings,prefix);
    if (!params.has("case") && !params.has("actions")) $("status").textContent = "Five offers have played. The third load is booked. Start at wave one to choose the opening yourself.";
  } catch {
    start({family:TARIFF_SUITE.splits.test.families[0],seed:TARIFF_SUITE.splits.test.start,priceCents:10},initialPrefix);
    $("status").textContent = "This run link was invalid. A new shift is open at the survey window.";
  }
  $("price").oninput = updatePriceLabel;
  $("price-form").onsubmit = event => {
    event.preventDefault();
    const priceCents = Number($("price").value);
    if (priceCents === config.priceCents) return;
    start({family:config.family,seed:config.seed,priceCents},historyCalls.slice(0,5));
    $("status").textContent = "Replayed your opening at " + priceLabel(priceCents) + " credits.";
    $("offer-heading").focus();
  };
  $("accept").onclick = () => act(true);
  $("pass").onclick = () => act(false);
  for (const id of ["reset","again"]) $(id).onclick = () => { start(config); $("status").textContent = "Restarted the same shift."; $("offer-heading").focus(); };
  $("case-form").onsubmit = event => {
    event.preventDefault();
    try { start(readConfig($("family").value,$("seed").value,String(config.priceCents))); $("config").open = false; $("offer-heading").focus(); $("status").textContent = "Loaded a new shift."; }
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
