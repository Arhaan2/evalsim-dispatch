import test from "node:test";
import assert from "node:assert/strict";
import {makeCard,cardURL,parseCardHash,exportCard,cardMarkup,representativeWeeks} from "../docs/lib/closure-scorecard.js";
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
  const bad=makeCard(makeReport(),bank,digest,digest);
  bad.examples[0].actions[0]="<script>";
  assert.throws(()=>cardURL(bad));
});
