import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createFleetWeek} from "../../docs/lib/fleetweek.js";
import {replayFleetActions} from "../../docs/lib/fleetweek-benchmark.js";
import {DECISION_MS, FIT_SEEDS, fleetLedger, pairedFleetComparison} from "../../docs/lib/fleetweek-study.js";
import {overnightReferences} from "../../docs/lib/overnight-benchmark.js";
import {OVERNIGHT_SUITE,OVERNIGHT_SPLITS,overnightCases,summarizeOvernight} from "../../docs/lib/overnight-study.js";
import {makeOvernightPolicy} from "../../docs/lib/overnight-policy.js";
import {fitOvernight} from "./fit.mjs";
import {nightBranches,summarizeNights} from "./diagnostics.mjs";

const mode=process.argv[2];
if (!["--check","--write"].includes(mode)) throw Error("Choose --write to release or --check to reproduce.");
const dir=new URL("../../docs/data/overnight/",import.meta.url);
if (mode==="--write") await mkdir(dir,{recursive:true});
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function artifact(name,data) {
  const bytes=JSON.stringify(data)+"\n", url=new URL(name,dir);
  if (mode==="--check") assert.equal(hash(await readFile(url)),hash(bytes),name+" differs from the release");
  else await writeFile(url,bytes);
  return hash(bytes);
}
function score(config,fn) {
  const s=createFleetWeek(config), actions=[];
  while (!s.done) {
    const obs=s.observe(), legal=s.legalActions(), start=performance.now();
    const id=fn(obs,legal);
    if (performance.now()-start>DECISION_MS) throw Error("Decision exceeded the registered time limit.");
    s.step(id);
    actions.push(id);
  }
  const ledger=fleetLedger(s.ledger);
  assert.deepEqual(replayFleetActions(config,actions),ledger);
  return {actions,ledger};
}

const previousBytes=await readFile(new URL("../fleetweek/model-13.json",dir));
const previous=JSON.parse(previousBytes);
const previousMetadata=JSON.parse(await readFile(new URL("../fleetweek/results.json",dir),"utf8"));
assert.equal(hash(previousBytes),previousMetadata.weightHashes[13]);
const results={suite:OVERNIGHT_SUITE, primarySeed:FIT_SEEDS[0], fitSeeds:FIT_SEEDS, weightHashes:{}, previousHash:hash(previousBytes), banks:{}, splits:{}};
const fits=[];
for (const seed of FIT_SEEDS) {
  const current=await fitOvernight(seed);
  fits.push({seed,current});
  results.weightHashes[seed]=await artifact("model-"+seed+".json",current);
  console.log("Completed train-only fit and selection",seed);
}
const references=overnightReferences({current:fits[0].current,previous});
for (const split of OVERNIGHT_SPLITS) {
  const cases=overnightCases(split).map(config=>{
    const agents=Object.fromEntries(Object.entries(references).map(([key,fn])=>[key,score(config,fn)]));
    return {...config,...agents,...nightBranches(config,agents.rl,references.rl)};
  });
  results.banks[split]=await artifact(split+".json",{suite:OVERNIGHT_SUITE,split,cases});
  const rows=cases.map(row=>({family:row.family,agent:row.rl.ledger,
    ...Object.fromEntries(Object.keys(references).map(key=>[key,row[key].ledger]))}));
  const summary=summarizeOvernight(rows);
  const replicate=fits.map(({seed,current})=>{
    const fn=makeOvernightPolicy(current);
    const r=seed===FIT_SEEDS[0]?rows:cases.map((config,i)=>({...rows[i],agent:score(config,fn).ledger}));
    return {seed,net:r.reduce((s,w)=>s+w.agent.net,0)/r.length,onTime:10*r.reduce((s,w)=>s+w.agent.served,0)/r.length,
      planner:pairedFleetComparison(r,"planner")};
  });
  results.splits[split]={summary,fits:replicate,diagnostics:summarizeNights(cases)};
  console.log("Scored",split,cases.length,"weeks, all fits, empty/wait counterfactuals and planner overrides.");
}
const fresh=results.splits.test.summary.all;
const doubleReturn=results.splits.archive.summary.all.earnsMoreThanPlanner;
results.goals={freshProfit:fresh.earnsMoreThanPlanner,freshService:fresh.matchesPlannerService,doubleReturn,
  joint:fresh.beatsPlanner && doubleReturn};
await artifact("results.json",results);
console.log(mode==="--check"?"Reproduced all checkpoints, decisions, scored branches and paired comparisons.":"Published experiment files generated.");
