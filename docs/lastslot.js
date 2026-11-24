import { $, num, scrollTable, table, text } from "./lib/freight-view.js";
import { dataRow } from "./lib/demand-desk.js";
import { note, pairedDesk, verifyInWorker } from "./lib/paired-desk.js";
import { LASTSLOT_SUITE, LASTSLOT_PATTERNS, PRICE_CENTS, createLastslot, observeLastslot, stepLastslot, verifyLastslot } from "./lib/lastslot.js";
import { decodeLastslotCase, lastslotReferences } from "./lib/lastslot-benchmark.js";
import { lastslotDecision } from "./lib/lastslot-policy.js";
import { tariffPlannerDecision } from "./lib/tariff-policy.js";

const names = {
  rl: "Last-slot agent", rlNever: "Agent · always skip", planner: "Price-aware planner", rlAlways: "Agent · forced buy",
  tariff: "Survey pricing", paid: "One-credit survey", stochastic: "Original planner", booking: "Booking",
  survey: "Survey", rally: "Rally", trust: "Trust", drift: "Drift", turns: "Turns"
};
const calls = { accept: "Book", pass: "Pass", buy: "Buy", skip: "Skip" };
const initialPrefix = ["pass", "pass", "accept", "pass", "pass"];
const { picker, reportGroups } = pairedDesk({ suite: LASTSLOT_SUITE, patterns: LASTSLOT_PATTERNS, names, compareKeys: ["rl","rlNever","planner"],
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

function readConfig(number, raw, price) {
  if (!/^\d{1,10}$/.test(raw) || Number(raw) > 0xffffffff) throw new Error("Enter a seed from 0 to 4294967295.");
  const seed = Number(raw), family = picker.decode(number, seed);
  if (!family) throw new Error("Choose a listed case.");
  if (!/^\d{1,3}$/.test(price) || Number(price) > 100) throw new Error("Enter a survey price from 0 to 100 cents.");
  return { family, seed, priceCents:Number(price) };
}

function renderDesk() {
  const o = observeLastslot(state), survey = o.phase === "survey";
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
  $("slot-count").textContent = o.slots === 1 ? "One slot left" : o.slots + " of " + o.capacity + " slots open";
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
  $("reveal-hint").hidden = historyCalls.length > 5;
  $("compare").hidden = historyCalls.length <= 5;
  $("current-score").textContent = o.gross + " freight credits − " + o.feePaid + " survey fee = " + o.net + " net";
  $("active-config").textContent = "Price " + priceLabel(config.priceCents) + " · Seed " + config.seed;
  const url = shiftUrl(config,historyCalls,location.hash);
  $("share").href = url;
  history.replaceState(null,"",url);
}

function start(settings, prefix = []) {
  const next = createLastslot(settings);
  for (const id of prefix) stepLastslot(next,id);
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
  const o = observeLastslot(state), id = o.phase === "survey" ? (primary ? "buy" : "skip") : (primary ? "accept" : "pass");
  const next = stepLastslot(state,id);
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
  const shift = createLastslot(settings), trace = [];
  while (!observeLastslot(shift).done) {
    const o = observeLastslot(shift), decision = decide(o, trace.length);
    trace.push({ phase:o.phase, action:decision, offer:o.offer?.net, slots:o.slots, reading:o.reading });
    stepLastslot(shift,decision);
  }
  const score = verifyLastslot(shift);
  if (score.violations.length) throw new Error("The shift ledger did not reconcile.");
  return { trace, score };
}
function money(value) { return value == null ? "—" : num(value,3); }
const difference = value => (value > 0 ? "+" : "") + num(value, value && Math.abs(value) < 0.001 ? 6 : 3);
const interval = ref => difference(ref.delta) + " [" + ref.interval95.map(difference).join(", ") + "]";
function renderAdvice() {
  const o = observeLastslot(state);
  if (o.phase !== "survey" || !weights) return;
  const agent = lastslotDecision(o,weights.lastslot,weights);
  const rows = [[names.rl, agent], [names.planner, tariffPlannerDecision(o,weights.tariff)]]
    .map(([label,d])=>[label,money(d.buyValue),money(d.skipValue),calls[d.action]]);
  const explanation = o.slots === 1
    ? "From your first five offers and the bulletin, the specialist estimates a reading adds " + difference(agent.advantage + o.surveyFee) + " freight credits before fees. It buys when that value exceeds " + priceLabel(config.priceCents) + "."
    : "The specialist always skips when the number of open slots is zero or two.";
  $("live-estimates").replaceChildren(note(explanation + " Each estimate is in remaining net credits."),
    grid(["Dispatcher","Buy","Skip","Call"],"Net value of buying and skipping before seeing the signal",rows));
}
function compare() {
  if (historyCalls.length <= 5) return;
  if (!weights) { $("comparison").replaceChildren(note("Loading the published checkpoints…")); return; }
  const candidates = [["rl",names.rl,replay(config,refs.rl)],["rlNever",names.rlNever,replay(config,refs.rlNever)],["planner",names.planner,replay(config,refs.planner)]];
  const visitor = submittedCase(config);
  if (visitor) candidates.push(["external","Submitted agent",replay(config,(_, i) => visitor.actions[i])]);
  const { family, seed } = config, p = LASTSLOT_PATTERNS[family], tail = [];
  const scores = candidates.map(([,label,r]) => [label,r.score.bought ? "Buy" : "Skip",r.score.reading == null ? "—" : r.score.reading+" / 6",r.score.gross,r.score.feePaid,r.score.net]);
  const actions = candidates[0][2].trace.map((x,i) => [x.phase === "survey" ? "Survey" : i<5 ? i+1 : i, x.offer ?? "—",
    ...candidates.map(([, ,r])=>calls[r.trace[i].action]),calls[historyCalls[i]] ?? "—"]);
  const decisions = candidates.filter(([id]) => id === "rl" || id === "planner").map(([id,label]) => {
    const s = createLastslot(config);
    historyCalls.slice(0,5).forEach(action => stepLastslot(s,action));
    const o = observeLastslot(s);
    const d = id === "rl" ? lastslotDecision(o,weights.lastslot,weights) : tariffPlannerDecision(o,weights.tariff);
    const branches = ["buy","skip"].map(action => {
      const branch = structuredClone(s);
      stepLastslot(branch,action);
      while (!branch.done) stepLastslot(branch,refs[id](observeLastslot(branch)));
      return (verifyLastslot(branch).netCents-o.netCents)/100;
    });
    return [label,o.slots,money(d.buyValue),money(d.skipValue),calls[d.action],...branches];
  });
  const feeState = createLastslot(config);
  for (let i=0;i<5;i++) stepLastslot(feeState,"pass");
  const reading = stepLastslot(feeState,"buy").reading;
  const twin = p.stem + "-" + (p.ending==="hot" ? "cold" : "hot");
  if (LASTSLOT_PATTERNS[twin]) {
    const links = document.createElement("div"); links.className = "section-links";
    links.append(link("Play the "+LASTSLOT_PATTERNS[twin].ending+"-ending twin →",{family:twin,seed,priceCents:config.priceCents},[],"session"));
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
  $("comparison").replaceChildren(text("h3",p.label),note("The fresh survey sampled " + reading + " high outcomes out of six. The full-shift policies below each chose their own opening from wave one. A policy that skipped the survey played the remaining offers with its public history."),
    grid(["Dispatcher","Survey","Reading","Freight","Fee","Net"],"Freight contribution and survey fees",scores),
    text("h3","Buy or skip on your opening"),note("Both dispatchers inherit your first five calls. Each buy estimate includes the posted fee. A dash means that dispatcher always skips at this capacity."),
    note("The two replay columns show the remaining net credits when that dispatcher is forced to buy or skip on this tape."),
    grid(["Dispatcher","Open slots","Buy estimate","Skip estimate","Call","Buy replay","Skip replay"],"Expected and realized remaining net credits for each purchase decision",decisions),
    grid(["Wave","Signed offer",...candidates.map(x=>x[1]),"Your call"],"Every booking and survey call, in order",actions),more,...tail);
}

const targetMarkets = [
  {label:"Hot-ending drops",stratum:"interrupted-drop",ending:"hot",check:"hotDrops"},
  {label:"Cold-ending reversals",stratum:"reversal",ending:"cold",check:"coldReversals"}
];
const marketGroup = (summary, market) => summary.positiveByStratumEnding[market.stratum][market.ending];
const historyMargins = {stochastic:0, booking:0, survey:0, tariff:-1, paid:-1, rally:-1, trust:-1, drift:-1, turns:-1};

function evidence(study) {
  const {splits,checks} = study;
  const test = splits.test;
  const cards = document.createElement("div");
  cards.className = "market-results";
  for (const market of targetMarkets) {
    const group = marketGroup(test.summary, market);
    const card = document.createElement("section");
    const beatSkip = group.references.rlNever.interval95[0] > 0;
    const beatPlanner = group.references.planner.interval95[0] > 0;
    const result = checks[market.check] ? "Beat both controls" : beatPlanner ? "Beat the planner only" : beatSkip ? "Beat always skipping only" : "Neither win was established";
    const headline = text("h4",result);
    const rows = ["rl","rlNever","planner"].map(id => {
      const policy = group.references[id];
      return [names[id],money(policy.mean),id === "rl" ? "—" : interval(policy)];
    });
    card.append(text("h3",market.label),headline,note(num(group.tapes) + " freight tapes · " + num(group.shifts) + " priced shifts"),
      grid(["Dispatcher","Mean net","Agent minus control [95%]"],market.label + " at positive prices",rows));
    cards.append(card);
  }
  const retention = splits.retention.summary.all;
  const history = Object.entries(historyMargins).map(([id,margin]) => {
    const ref = retention.references[id];
    return [names[id],interval(ref),margin,ref.interval95[0] > margin ? "Passed" : "Missed"];
  });
  $("scorecard").replaceChildren(cards,
    note("Each tape is played at six positive prices from 0.05 to 1 credit. Differences are in net credits per shift. Paired 95% intervals keep all families and prices for each seed together. A fresh win needs both lower bounds above zero."),
    text("h3", checks.originalDrop ? "Original interrupted-drop gains retained" : "Original interrupted-drop target missed"),
    note("On " + num(retention.tapes) + " original-pattern freight tapes at all seven prices, the agent averaged " + money(retention.mean) + " net credits. Its paired gains were " + interval(retention.references.stochastic) + " against the original planner and " + interval(retention.references.booking) + " against Booking. Retention requires every lower bound to clear its published margin."),
    details("See all original-drop margins",grid(["Reference","Agent minus reference [95%]","Required lower bound","Result"],"Original interrupted-drop comparisons including the free price",history)),
    text("p",checks.joint ? "All three benchmark targets passed." : "The full benchmark target was missed."));
  acquisitionEvidence(test);
  workedExamples(study.examples);
}

function acquisitionEvidence(test) {
  const matched = [], own = [];
  for (const market of targetMarkets) {
    const common = marketGroup(test.matched,market), ref = common.references;
    matched.push([market.label,num(common.shifts),num(common.seeds),num(ref.rl.bought),money(ref.rl.mean),interval(ref.rlNever),interval(ref.planner)]);
    const ownPath = test.opportunities[market.stratum + "/" + market.ending].positive;
    own.push([market.label,num(ownPath.shifts),num(ownPath.oneSlot),num(ownPath.bought),money(ownPath.feeCents/100),
      ownPath.bought ? difference(ownPath.buyGainCents/(100*ownPath.bought)) : "—"]);
  }
  const selector = document.createElement("select"), label = document.createElement("label");
  label.className = "market-select";
  label.append("Market",selector);
  for (const [i,market] of targetMarkets.entries()) selector.add(new Option(market.label,String(i)));
  const panel = document.createElement("div");
  function prices() {
    const market = targetMarkets[Number(selector.value)];
    const context = test.opportunities[market.stratum + "/" + market.ending];
    const rows = PRICE_CENTS.map(cents => {
      const o = context.byPrice[cents];
      const ref = test.summary.byPrice[cents].byStratumEnding[market.stratum][market.ending].references;
      return [priceLabel(cents),num(o.oneSlot),num(o.bought),o.oneSlot ? num(100*o.bought/o.oneSlot,1)+"%" : "—",interval(ref.rlNever),interval(ref.planner)];
    });
    panel.replaceChildren(grid(["Price","One slot left","Agent buys","Buy rate","Versus skip [95%]","Versus planner [95%]"],"One-slot purchases and full-shift net comparisons by price",rows));
  }
  selector.onchange = prices;
  prices();
  $("acquisition").replaceChildren(
    text("h3","Same opening, one slot each"),
    note("The previous Survey pricing agent plays the first five offers. Where it leaves exactly one slot, all three dispatchers inherit its bookings, the posted fee and the same remaining freight. This diagnostic uses positive prices."),
    grid(["Market","Eligible shifts","Seeds","Agent buys","Agent net","Versus skip [95%]","Versus planner [95%]"],"Common-opening one-slot diagnostic after all fees",matched),
    text("h3","When the agent drives from wave one"),
    note("Count each one-slot opportunity reached on the agent’s own opening. For purchases, replay the same opening and later offers with the survey skipped. The purchase gain includes the fee."),
    grid(["Market","Priced shifts","One slot left","Agent buys","Fees paid","Gain per buy"],"Own-opening opportunity counts and realized fee-adjusted gains from selected purchases at positive prices",own),
    details("Break down full shifts by price",label,panel));
}

function submittedCase(settings) {
  if (!imported) return;
  const split = LASTSLOT_SUITE.splits[imported.split];
  const family = split.families.indexOf(settings.family), price = PRICE_CENTS.indexOf(settings.priceCents);
  const seedIndex = settings.seed - split.start;
  if (family < 0 || price < 0 || seedIndex < 0 || seedIndex >= split.count) return;
  const i = (seedIndex * split.families.length + family) * PRICE_CENTS.length + price;
  return decodeLastslotCase(imported.split,imported.cases[i]);
}

function workedExamples(examples) {
  const container = $("worked-examples");
  const items = [];
  for (const example of examples) {
    const {family,seed,priceCents} = example;
    const settings = {family,seed,priceCents};
    const opening = replay(settings,refs.rl).trace.slice(0,5).map(x=>x.action);
    const gate = createLastslot(settings);
    for (const call of opening) stepLastslot(gate,call);
    const decision = lastslotDecision(observeLastslot(gate),weights.lastslot,weights);
    const branches = ["buy","skip"].map(choice => replay(settings,(o,i) => i < 5 ? opening[i] : i === 5 ? choice : refs.rl(o)));
    const delta = (branches[0].score.netCents - branches[1].score.netCents)/100;
    const block = document.createElement("section");
    const rows = branches.map(({score,trace})=>[calls[trace[5].action],score.reading == null ? "—" : score.reading + " / 6",
      trace.slice(6).map((x,i)=>calls[x.action]+" "+(i+6)).join(" · "),money(score.gross),money(score.feePaid),money(score.net)]);
    block.append(text("h3",delta > 0 ? "When buying pays off" : "When buying costs credits"),
      note("Seed " + seed + " · " + LASTSLOT_PATTERNS[family].label + " · price " + priceLabel(priceCents) + ". The agent chose to " + decision.action + ". Buying changed its net earnings by " + difference(delta) + " credits on this tape."),
      details("Reveal the reading and booking decisions",grid(["Call","Reading","Last three offers","Freight","Fee","Net"],"Matched buy and skip continuations on seed " + seed,rows)),
      link("Play this one-slot opening →",settings,opening,"session"));
    items.push(block);
  }
  container.replaceChildren(note("Both branches use the same first five decisions and freight offers. Open a ledger to see how the survey changed the outcome."),...items);
}
function reportView(report) {
  const refs = report.summary.all.references;
  const rows = Object.entries(refs).map(([k,a])=>[names[k]??k,money(a.mean),interval(a)]);
  const inspect = text("button","Replay the first submitted shift"); inspect.type = "button";
  inspect.onclick = () => {
    const first = decodeLastslotCase(report.split,report.cases[0]);
    start(first,first.actions); $("compare").open = true; compare(); $("compare").querySelector("summary").focus();
  };
  const targetRows = targetMarkets.flatMap(market => {
    const group = report.summary.positiveByStratumEnding[market.stratum]?.[market.ending];
    return group ? [[market.label,num(group.shifts),money(group.mean),interval(group.references.rlNever),interval(group.references.planner)]] : [];
  });
  $("report-result").replaceChildren(note("Your agent averaged " + money(report.summary.all.mean) + " net credits per shift."),
    ...(targetRows.length ? [grid(["Positive-price market","Shifts","Your net","Versus skip [95%]","Versus planner [95%]"],"Submitted agent on the target endings after fees",targetRows)] : []),
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
    await verifyInWorker(new URL("./lib/lastslot-report-worker.js",import.meta.url), report, {weights,bankDigests:release.banks});
    imported = report;
    reportView(report);
    $("report-status").textContent = report.policy + " verified on " + num(report.cases.length) + " " + report.split + " shifts.";
    if ($("compare").open) compare();
  } catch (err) { $("report-status").textContent = "Could not verify the report. " + err.message; }
  finally { $("report-file").disabled = false; $("report-file").value = ""; }
}
async function loadStudy() {
  try {
    const response = await fetch("./data/lastslot/desk.json");
    if (!response.ok) throw new Error("Could not load the public checkpoint.");
    release = await response.json();
    weights = release.weights;
    refs = lastslotReferences(weights);
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
    start({family:LASTSLOT_SUITE.splits.test.families[0],seed:LASTSLOT_SUITE.splits.test.start,priceCents:10},initialPrefix);
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
  if (hash === "#compare" && historyCalls.length > 5) $("compare").open = true;
  loadStudy();
}
init();
