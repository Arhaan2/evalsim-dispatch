// Diagnose opportunities using realized returns only after all three models are frozen.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fridayMask,loadFridayGuardBank} from "../../docs/lib/fridayguard-study.js";
import {artifact,hash} from "../fleetweek/score-helpers.mjs";

const mode=process.argv[2];
if (!["--write","--check"].includes(mode)) throw Error("Use --write or --check.");
const data=new URL("../../docs/data/fridayguard/",import.meta.url);
const official=JSON.parse(await readFile(new URL("results.json",data)));
const bank=await loadFridayGuardBank("test",async(file,expected)=>{
  const bytes=await readFile(new URL(file,data));
  assert.equal(hash(bytes),expected,file);
  return JSON.parse(bytes);
},official.banks.test);
const out={suite:official.suite,bankHash:official.banks.test,weeks:bank.cases.length,
  disagreements:0,winWinWeeks:0,captured:0,fridayMaxGain:0,netMaxGain:0,meanNetCeilingVsPlanner:0};
let ceilingCredits=0;
const fridays=path=>[0,1,1,2][fridayMask(path.actions)];
for (const {warningEpoch:t,previous,fit211,frozen73,rl,planner} of bank.cases) {
  assert(Number.isInteger(t));
  const paths=[previous,fit211,frozen73];
  assert(paths.some(p=>p.actions[t]===rl.actions[t] && p.ledger.net===rl.ledger.net && p.actions.every((a,i)=>a===rl.actions[i])));
  if (paths.every(p=>p.actions[t]===previous.actions[t])) {
    assert(paths.every(p=>p.actions.every((a,i)=>a===previous.actions[i])));
  } else out.disagreements++;
  const friday=fridays(previous);
  const winWin=p=>fridays(p)>friday && p.ledger.served>=previous.ledger.served && p.ledger.net>=previous.ledger.net;
  if (paths.some(winWin)) out.winWinWeeks++;
  if (winWin(rl)) out.captured++;
  out.fridayMaxGain+=Math.max(...paths.map(fridays))-friday;
  const bestCredits=Math.max(...paths.map(p=>p.ledger.net));
  out.netMaxGain+=bestCredits-previous.ledger.net;
  ceilingCredits+=bestCredits-planner.ledger.net;
}
assert(out.captured<=out.winWinWeeks);
out.meanNetCeilingVsPlanner=ceilingCredits/out.weeks;
await artifact(data,mode,"opportunities.json",out);
console.log("Won on Friday with full-week service and earnings intact on",out.captured,"of",out.winWinWeeks,"hindsight opportunities.");
