import test from "node:test";
import assert from "node:assert/strict";
import {SWITCH_COST_CARD_VERSION,ADD_GUARD_CARD_VERSION,MOVE_RECALL_CARD_VERSION,LONG_MOVE_CARD_VERSION,SHORT_DEFAULT_CARD_VERSION,scorecardBaselines,LONG_REPAIR_CARD_VERSION,makeCard,cardURL,parseCardHash,exportCard,cardMarkup,representativeWeeks} from "../docs/lib/closure-scorecard.js";
import {createClosureWeek} from "../docs/lib/closure-world.js";
import {replayWeek} from "../docs/lib/closure-view.js";

const config={family:"steady-market",seed:11,closure:{starts:[2],durations:[2]}};
function play(pick) {
  const sim=createClosureWeek(config), actions=[];
  while (!sim.done) {
    const id=pick(sim.legalActions());
    actions.push(id);sim.step(id);
  }
  return {actions,ledger:sim.ledger};
}
const wait=play(()=>"W|W"), greedy=play(menu=>menu.reduce((best,a)=>a.net>best.net?a:best).id);
const reference={...config,planner:wait,flatRisk:greedy,rl:greedy};
const pair={net:1,net95:[-1,3],servicePP:0,service95:[-.25,.25],wins:1,losses:0,ties:0};
function makeReport(choice=greedy) {
  return {policy:'Snow 🚚 <img src=x onerror=alert(1)>',split:"validation",cases:[{...config,...choice}],
    summary:{all:{weeks:1,policies:{agent:{net:choice.ledger.net,onTime:10*choice.ledger.served}},
      comparisons:{flatRisk:pair,planner:choice===wait?{...pair,wins:0,ties:1}:pair}}}};
}
const bank={cases:[reference]}, digest="1".repeat(64);
test("closure scorecard links preserve names, intervals, both bank fingerprints and reproducible actions",()=>{
  const card=makeCard(makeReport(),bank,digest,"2".repeat(64));
  const link=new URL(cardURL(card));assert.equal(link.pathname,"/evalsim-dispatch/closure.html");
  assert.deepEqual(parseCardHash(link.hash),card);
  const week=replayWeek(reference,card.examples[0].actions);
  assert.deepEqual(week.ledgers,[greedy.ledger,wait.ledger,greedy.ledger,greedy.ledger]);
  assert.equal(week.rounds.length,10);
  assert(week.rounds.some(r=>r[1].includes("will close")));
  assert(week.rounds.some(r=>r[1].includes("repairs")));
  const html=exportCard(card,[week]);
  assert(!html.includes("<img"));assert(!html.includes("<script"));assert(html.includes("&lt;img"));
  assert(html.includes("Constant penalty"));assert(html.includes("Original JSON"));assert(html.includes("Self-benchmarked"));
  assert(cardMarkup(card,[week],true).includes("replayed the full report"));
  assert(html.includes("sender reports the aggregate"));
});
test("loss and win examples use nearest median and break ties by manifest order",()=>{
  const gaps=[-1,9,8,-4,10,0,-2,7,-10];
  const report={cases:gaps.map((net,i)=>({ledger:{net},actions:[i]}))};
  const b={cases:gaps.map(()=>({planner:{ledger:{net:0}}}))};
  assert.deepEqual(representativeWeeks(report,b).map(r=>r.i),[1,3]);
});
test("all-tie report has an explicit empty example set and rejects malformed or inconsistent links",()=>{
  const c=makeCard(makeReport(wait),bank,digest,digest);
  assert.deepEqual(c.examples,[]);assert(cardMarkup(c,[],false).includes("Every week tied"));
  for (const edit of [{v:"old"},{split:"toString"},{n:2},{reportHash:"x"},{counts:[1,0,0]}]) {
    assert.throws(()=>cardURL({...c,...edit}));
  }
  assert.throws(()=>parseCardHash("#card="+"a".repeat(6500)));
  const bad=structuredClone(makeCard(makeReport(),bank,digest,digest));
  bad.examples[0].actions[0]="<script>";
  assert.throws(()=>cardURL(bad));
});

test("long-repair scorecards link to their own release and label the correct replay policy",()=>{
  const card=makeCard(makeReport(),bank,digest,digest,LONG_REPAIR_CARD_VERSION);
  const link=new URL(cardURL(card));
  assert.equal(link.pathname,"/evalsim-dispatch/longrepair.html");
  assert.deepEqual(parseCardHash(link.hash),card);
  const page=exportCard(card,[replayWeek(reference,card.examples[0].actions)]);
  assert(page.includes("Long-repair RL"));
  assert(page.includes("longrepair.html#own-agent"));
  assert(page.includes("longrepair-v1.0.0"));
  assert(!page.includes("<img"));
});

test("short-default scorecards bind their third comparison to a replayable short-trained default",()=>{
  const report=makeReport();
  report.summary.all.comparisons.shortGate={...pair,net:-1};
  const enriched={...reference,shortGate:wait};
  const card=makeCard(report,{cases:[enriched]},digest,digest,SHORT_DEFAULT_CARD_VERSION);
  assert.equal(card.comparisons.length,3);
  assert.equal(card.comparisons[2][0],-1);
  const link=new URL(cardURL(card));
  assert.equal(link.pathname,"/evalsim-dispatch/shortdefault.html");
  assert.deepEqual(parseCardHash(link.hash),card);
  const week=replayWeek(enriched,card.examples[0].actions,scorecardBaselines(card.v));
  assert.deepEqual(week.ledgers,[greedy.ledger,wait.ledger,greedy.ledger,wait.ledger,greedy.ledger]);
  assert(exportCard(card,[week]).includes("Short-trained default · credits/week"));
  assert.throws(()=>cardURL({...card,comparisons:card.comparisons.slice(0,2)}));
  assert.throws(()=>cardURL({...card,v:LONG_REPAIR_CARD_VERSION}));
});

test("long-move links use their own release route, replay label and three reference comparisons",()=>{
  const report=makeReport();
  report.summary.all.comparisons.shortGate=pair;
  const card=makeCard(report,bank,digest,digest,LONG_MOVE_CARD_VERSION);
  const link=new URL(cardURL(card));
  assert.equal(link.pathname,"/evalsim-dispatch/longmove.html");
  assert.deepEqual(parseCardHash(link.hash),card);
  const week=replayWeek({...reference,shortGate:wait},card.examples[0].actions,scorecardBaselines(card.v));
  const page=exportCard(card,[week]);
  assert(page.includes("Long-move RL"));
  assert(page.includes("Short-trained default · credits/week"));
  assert(page.includes("longmove.html#own-agent"));
});

test("move-recall scorecard includes the previous detector in its own versioned comparison and week replay",()=>{
  const report=makeReport();
  Object.assign(report.summary.all.comparisons,{shortGate:pair,previous:{...pair,net:-1}});
  const row={...reference,shortGate:wait,previous:greedy}, ref={cases:[row]};
  const card=makeCard(report,ref,digest,digest,MOVE_RECALL_CARD_VERSION);
  assert.equal(card.comparisons.length,4);
  assert.equal(card.comparisons[3][0],-1);
  const url=new URL(cardURL(card));
  assert.equal(url.pathname,"/evalsim-dispatch/moverecall.html");
  assert.deepEqual(parseCardHash(url.hash),card);
  const week=replayWeek(row,card.examples[0].actions,scorecardBaselines(card.v));
  assert.deepEqual(week.ledgers,[greedy.ledger,wait.ledger,greedy.ledger,wait.ledger,greedy.ledger,greedy.ledger]);
  const html=exportCard(card,[week]);
  assert(html.includes("Previous detector · credits/week"));
  assert(html.includes("Move-recall RL"));
  assert.throws(()=>cardURL({...card,v:LONG_MOVE_CARD_VERSION}));
});

test("switch-cost scorecards compare with the move-recall release and keep their own weekly ledger",()=>{
  const report=makeReport();
  Object.assign(report.summary.all.comparisons,{shortGate:pair,previous:{...pair,net:-3}});
  const row={...reference,shortGate:wait,previous:greedy};
  const card=makeCard(report,{cases:[row]},digest,digest,SWITCH_COST_CARD_VERSION);
  assert.equal(card.comparisons[3][0],-3);
  const link=new URL(cardURL(card));
  assert.equal(link.pathname,"/evalsim-dispatch/switchcost.html");
  assert.deepEqual(parseCardHash(link.hash),card);
  const week=replayWeek(row,card.examples[0].actions,scorecardBaselines(card.v));
  const html=exportCard(card,[week]);
  assert(html.includes("Move-recall RL · credits/week"));
  assert(html.includes("Switch-cost RL"));
  assert(html.includes("switchcost.html#own-agent"));
  assert(!html.includes("<img"));
});

test("fit 73 guard scorecards preserve both predecessor comparisons in HTML and replay",()=>{
  const report=makeReport();
  Object.assign(report.summary.all.comparisons,{shortGate:pair,previous:{...pair,net:-3},original:{...pair,net:2}});
  const row={...reference,shortGate:wait,previous:greedy,original:wait};
  const card=makeCard(report,{cases:[row]},digest,digest,ADD_GUARD_CARD_VERSION);
  assert.deepEqual(card.comparisons.slice(3).map(r=>r[0]),[-3,2]);
  const link=new URL(cardURL(card));
  assert.equal(link.pathname,"/evalsim-dispatch/addguard.html");
  assert.deepEqual(parseCardHash(link.hash),card);
  const week=replayWeek(row,card.examples[0].actions,scorecardBaselines(card.v));
  assert.deepEqual(week.ledgers,[greedy.ledger,wait.ledger,greedy.ledger,wait.ledger,greedy.ledger,wait.ledger,greedy.ledger]);
  const html=exportCard(card,[week]);
  assert(html.includes("Frozen fit 73 · credits/week") && html.includes("Move-recall RL · credits/week"));
  assert(html.includes("addguard.html#own-agent"));
  assert.throws(()=>cardURL({...card,v:SWITCH_COST_CARD_VERSION}));
});
