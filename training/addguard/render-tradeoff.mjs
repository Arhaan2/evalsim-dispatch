import {readFile} from "node:fs/promises";
import {table, signed, writeSections} from "../fleetweek/render-decisions.mjs";
import {interval} from "../closure/repair-tables.mjs";
import {familyName, roundName} from "../../docs/lib/overnight-view.js";

const report=JSON.parse(await readFile(new URL("../../docs/data/addguard/tradeoff.json",import.meta.url)));
const {history,fresh,weekly,archive}=report;
const fields=group=>[group.vsParent.avoidedLosses, group.vsParent.dropped.wins, group.vsParent.dropped.ties];
const rows=[["Original 24 additions",history],["Fresh additions",fresh]].map(([name,r])=>{
  const g=r.groups.added;
  return [name,g.vsParent.n,...fields(g),g.outcomes.rl.wins+" / "+g.vsParent.profitable];
});
const {all,added}=fresh.groups;
const original=history.groups.added.vsParent;
const pct=(d,c)=>signed(d*100,2)+" ["+c.map(x=>signed(x*100,2)).join(", ")+"]";
const cases=[["Loss avoided",fresh.examples.find(e=>e.longMinusShort<0)],["Profitable move given up",fresh.examples.find(e=>e.longMinusShort>0)]]
  .filter(([,e])=>e).map(([name,e])=>[name,familyName(e.family)+" · "+e.seed,roundName(e.epoch),e.shortFriday,e.longFriday]);
const labs={previous:"Frozen fit 73",shortGate:"Always short",flatRisk:"Constant penalty",planner:"Rolling planner",original:"Earlier move-recall"};
const comparisons=Object.entries(labs).map(([key,label])=>[label,interval(weekly.comparisons[key]),interval(weekly.comparisons[key],true)]);
const text=[
  '<h2 id="tradeoff-title">What did an active veto cost?</h2>',
  '<p>One training candidate avoided 14 losses and gave up one winner on selection weeks. The registered rule required every winner to be kept. This separate exploratory comparison runs that rejected candidate on the same public weeks. It uses fit 101’s frozen cutoff for the riskiest 20% of training-calibration additions.</p>',
  '<p class="finding"><strong>On '+added.vsParent.n+' fresh additions it avoided '+added.vsParent.avoidedLosses+' of '+added.vsParent.oldLosses+' losses and gave up '+added.vsParent.dropped.wins+' profitable '+(added.vsParent.dropped.wins===1?'move':'moves')+'.</strong> On the original six losing additions it avoided '+original.avoidedLosses+' and gave up '+original.dropped.wins+' of the 15 profitable additions.</p>',
  table("When the candidate chose short",["Bank","Parent additions","Losses avoided","Winners given up","Ties vetoed","Profitable additions kept"],rows),
  '<p>Across all fresh opportunities it caught '+all.outcomes.rl.wins+' of '+all.vsParent.profitable+' profitable moves. The recall difference was '+pct(all.vsParent.recallDifference,all.vsParent.recall95)+' percentage points against fit 73 and '+pct(all.vsMoveRecall.recallDifference,all.vsMoveRecall.recall95)+' against move-recall. Avoided losses per 100 additions were '+pct(added.vsParent.lossReduction,added.vsParent.loss95)+'. Intervals are paired 95% estimates.</p>',
  '<details><summary>Follow the money and the contracts</summary><p>On the same short route the vetoes saved '+(-added.vsParent.dropped.losingCredits)+' credits on losses and gave up '+added.vsParent.dropped.winningCredits+' on winners. On its own route it changed actions in '+weekly.differentWeeks+' of '+weekly.weeks.toLocaleString("en-US")+' fresh weeks. The original double-return schedule produced the same actions as fit 73, earning '+interval(archive.comparisons.planner)+' credits/week over the planner.</p>',
  table("Candidate difference on complete fresh weeks [95% interval]",["Compared with","Net credits/week","On-time difference (pp)"],comparisons),
  ...(cases.length?[table("First veto examples, with the same freight through Friday",["Outcome","Market and week seed","Board","Short-first net","Long-first net"],cases)]:[]),
  '</details><p>Run the alternative on the public benchmark with <code>--policy candidate-101</code>. Its cutoff was chosen using training-selection outcomes. The extra analysis was specified after the official evaluation began and is exploratory.</p>',
  '<p class="link-row"><a href="./data/addguard/tradeoff.json">Download comparison and vetoed cases</a><a href="https://github.com/Arhaan2/evalsim-dispatch/blob/fd30d13f00b7a8938b608da8e230b88ea44eb2c0/training/addguard/SENSITIVITY.md">Selection record ↗</a><a href="#own-agent">Benchmark your agent →</a></p>'
].join("\n");
await writeSections("addguard","addguard.html",{tradeoff:text});
