// Descriptive context added after scoring. Compare three prior frozen policies
// directly with the rolling planner using the same byte-verified fresh bank.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadFridayGuardBank} from "../../docs/lib/fridayguard-study.js";
import {paired} from "../fleetweek/audit-helpers.mjs";
import {artifact,hash} from "../fleetweek/score-helpers.mjs";

const mode=process.argv[2];
if(!["--write","--check"].includes(mode))throw Error("Use --write or --check.");
const data=new URL("../../docs/data/fridayguard/",import.meta.url);
const release=JSON.parse(await readFile(new URL("results.json",data)));
const bankHash=release.banks.test;
const {suite,split,cases}=await loadFridayGuardBank("test",async (file,digest)=>{
  const bytes=await readFile(new URL(file,data));
  assert.equal(hash(bytes),digest,file);
  return JSON.parse(bytes);
},bankHash);
const n=cases.length,baselines={};
const signed=(actions,t)=>Number(actions[t].split("|").includes("C"));
for(const key of ["previous","fit211","frozen73"]) {
  let netCredits=0,netDeliveries=0,saved=0,lost=0;
  const weeks=[],fridays=[];
  for(const c of cases) {
    const a=c[key],b=c.planner;
    netCredits+=a.ledger.net-b.ledger.net;
    netDeliveries+=a.ledger.served-b.ledger.served;
    weeks.push({family:c.family,agent:a.ledger,planner:b.ledger});
    let difference=0;
    for(const t of [8,9]){
      const delta=signed(a.actions,t)-signed(b.actions,t);
      saved+=Number(delta===1);lost+=Number(delta===-1);difference+=delta;
    }
    fridays.push({family:c.family,agent:{net:difference,served:0},planner:{net:0,served:0}});
  }
  const comparison=paired(weeks,"planner"),f=paired(fridays,"planner");
  const friday={saved,lost,net:saved-lost,perWeek:f.net,perWeek95:f.net95};
  assert.equal(comparison.net,netCredits/n);assert.equal(comparison.servicePP,10*netDeliveries/n);
  assert.equal(friday.perWeek,friday.net/n);
  // A-B equals (release-B) minus (release-A) on matched tapes for every additive metric.
  const primary=release.splits.test.fits[0];
  assert.equal(netCredits,primary.weeklyTotals.planner.netCredits-primary.weeklyTotals[key].netCredits);
  assert.equal(netDeliveries,primary.weeklyTotals.planner.netDeliveries-primary.weeklyTotals[key].netDeliveries);
  assert.equal(friday.net,primary.friday.comparisons.planner.net-primary.friday.comparisons[key].net);
  baselines[key]={netCredits,netDeliveries,comparison,friday};
}
await artifact(data,mode,"baselines.json",{suite,split,weeks:n,bankHash,reference:"planner",baselines});
console.log("Compared 3 frozen policies directly with the rolling planner on",n,"fresh weeks.");
