import { WAITCOST_PATTERNS, WAITCOST_SUITE, waitcostCases, createWaitcost, observeWaitcost,
  stepWaitcost, verifyWaitcost, waitcostCalls } from "./waitcost.js";
import { chooseWaitcost } from "./waitcost-policy.js";
import { scoreGroup, scoringRow } from "./lastslot-benchmark.js";
import { loadchoiceWeights, loadchoiceReferences } from "./loadchoice-benchmark.js";
export { scoringRow };

export const WAITCOST_REPORT="evalsim-waitcost-report-v1";
export const WAITCOST_EVALUATION_SPLITS=Object.freeze(["validation","test","retention","archive"]);
export const WAITCOST_KEYS=Object.freeze(["rl","rlNever","planner","rlAlways","loadchoice","unguarded","unguardedAlways","alwaysStop","alwaysStopForced","lastslot","tariff","paid","stochastic","booking","survey","rally","trust","drift","turns"]);
export const MATCHED_KEYS=Object.freeze(["rl","rlNever","planner"]);
export const waitcostWeights=(release,...previous)=>({...loadchoiceWeights(...previous),waitcost:release.checkpoint.weights});

export function waitcostReferences(weights) {
  const earlier=loadchoiceReferences(weights);
  const learner=mode=>o=>chooseWaitcost(o,weights.waitcost,weights,mode);
  // Isolate the stopping rule by keeping the newly calibrated gate (and price)
  // and replaying the preceding checkpoint's freight decisions after a buy.
  const withoutGuard=mode=>{
    const candidate=learner(mode);
    return o=>o.phase==="survey" ? candidate(o) : earlier.rl(o);
  };
  const alwaysStop=mode=>{
    const gate=learner(mode);
    return o=>{
      if(o.phase==="survey") return gate(o);
      const current=earlier.rl(o);
      if(o.slots!==1 || o.reading==null || current!=="pass" || o.wave<5 || o.wave>6) return current;
      return earlier.rl({...o,reading:null});
    };
  };
  return {rl:learner("optional"),rlNever:learner("never"),planner:earlier.planner,rlAlways:learner("always"),
    loadchoice:earlier.rl,unguarded:withoutGuard("optional"),unguardedAlways:withoutGuard("always"),
    alwaysStop:alwaysStop("optional"),alwaysStopForced:alwaysStop("always"),
    ...Object.fromEntries(WAITCOST_KEYS.slice(WAITCOST_KEYS.indexOf("lastslot")).map(k=>[k,earlier[k]]))};
}

export async function runWaitcostCase(config,decide) {
  if(typeof decide!=="function") throw new TypeError("Expected a policy function.");
  const state=createWaitcost(config),actions=[];
  let o=observeWaitcost(state);
  while(!o.done) {
    const action=await decide(o,waitcostCalls(o));
    o=stepWaitcost(state,action);
    actions.push(action);
  }
  const score=verifyWaitcost(state);
  if(score.violations.length || score.netCents!==score.grossCents-score.feeCents) throw new Error("One-slot freight ledger failed to reconcile.");
  return {actions,score};
}

function groupBy(rows,keyOf,reduce) {
  const groups=new Map();
  for(const row of rows) {
    const k=keyOf(row);
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(row);
  }
  return Object.fromEntries([...groups].map(([key,part])=>[key,reduce(part)]));
}

export function summarizeWaitcost(rows,keys,matched=false) {
  const group=part=>scoreGroup(part,keys);
  const stratum=r=>WAITCOST_PATTERNS[r.family].stratum,ending=r=>WAITCOST_PATTERNS[r.family].ending;
  const joint=part=>groupBy(part,stratum,section=>groupBy(section,ending,group));
  const positive=rows.filter(r=>r.priceCents>0);
  const core={all:group(rows),positive:group(positive),positiveByStratumEnding:joint(positive)};
  if(matched) return core;
  return {...core,byFamily:groupBy(rows,r=>r.family,group),byStratum:groupBy(rows,stratum,group),byEnding:groupBy(rows,ending,group),
    byStratumEnding:joint(rows),byPrice:groupBy(rows,r=>r.priceCents,p=>({all:group(p),byStratumEnding:joint(p)}))};
}

export function finishReference(state,decide) {
  let o=observeWaitcost(state);
  let gateSlots=null;
  while(!o.done) {
    if(o.phase==="survey") gateSlots=o.slots;
    o=stepWaitcost(state,decide(o));
  }
  const score=verifyWaitcost(state);
  if(score.violations.length) throw new Error("Reference ledger failed to reconcile.");
  const lateLoad=state.loads.find(load=>load.wave>=5);
  return {...score,gateSlots,loadWave:lateLoad ? lateLoad.wave+1 : 0};
}

export function referenceScores(config,refs,history,exposure) {
  let mask=0;
  const scores=[];
  for(const [i,k] of WAITCOST_KEYS.entries()) {
    // Historical zero-purchase rules have identical scores across tariffs.
    const priceIndependent=WAITCOST_KEYS.indexOf("stochastic")<=i;
    let score=priceIndependent ? history.get(k) : null;
    if(!score) {
      score=finishReference(createWaitcost(config),refs[k]);
      if(priceIndependent) history.set(k,score);
    }
    if(exposure && k==="rl") exposure.oneSlot=score.gateSlots;
    if(exposure && (k==="rlAlways" || k==="rlNever" || k==="unguardedAlways" || k==="alwaysStopForced")) exposure[k]=score.loadWave;
    if(score.bought) mask|=1<<i;
    scores.push(score.netCents);
  }
  return [mask,...scores];
}

function packCandidate(config, familyIndex, actions, score) {
  const mask=actions.reduce((bits,action,i)=>bits|((action==="accept" || action==="buy" ? 1 : 0)<<i),0);
  return [config.seed,familyIndex,config.priceCents,mask,score.netCents,score.feeCents,score.reading];
}
export function decodeWaitcostCase(split,row) {
  if(!Array.isArray(row) || row.length!==7 || !Number.isInteger(row[3]) || row[3]<0 || row[3]>511) throw new RangeError("Invalid packed nine-action record.");
  const [seed,familyIndex,priceCents,mask,netCents,feeCents,reading]=row;
  const family=WAITCOST_SUITE.splits[split].families[familyIndex];
  const actions=Array.from({length:9},(_,i)=>mask&(1<<i) ? (i===5?"buy":"accept"):(i===5?"skip":"pass"));
  return {seed,family,priceCents,actions,netCents,feeCents,grossCents:netCents+feeCents,reading,
    net:netCents/100,feePaid:feeCents/100,gross:(netCents+feeCents)/100};
}

export async function benchmarkWaitcost({split="test",policy,createPolicy,weights,bank}) {
  if(!WAITCOST_EVALUATION_SPLITS.includes(split)) throw new Error("Unknown one-slot split.");
  if(typeof policy!=="string" || !policy.trim() || policy.length>160) throw new Error("Use a policy name of 1–160 characters.");
  const manifest=waitcostCases(split),families=WAITCOST_SUITE.splits[split].families,refs=waitcostReferences(weights);
  if(bank && (bank.suite!==WAITCOST_SUITE.id || bank.split!==split || !same(bank.keys,WAITCOST_KEYS) || bank.scores?.length!==manifest.length)) throw new Error("Incompatible reference bank.");
  const rows=[],cases=[],history=new Map();
  let lastTape;
  for(const [i,config] of manifest.entries()) {
    try {
      const tape=config.seed+"/"+config.family;
      if(lastTape!==tape) {history.clear();lastTape=tape;}
      const packed=bank ? bank.scores[i]:referenceScores(config,refs,history);
      const {actions,score}=await runWaitcostCase(config,createPolicy());
      cases.push(packCandidate(config,families.indexOf(config.family),actions,score));
      rows.push(scoringRow(config,WAITCOST_KEYS,packed,score.netCents,score.bought));
    } catch(err) { throw new Error(config.family+" seed "+config.seed+" at "+config.priceCents+" cents: "+err.message,{cause:err}); }
  }
  return {format:WAITCOST_REPORT,suite:WAITCOST_SUITE.id,split,policy,summary:summarizeWaitcost(rows,WAITCOST_KEYS),cases};
}

function same(a,b) {
  if(a===b) return true;
  if(!a || !b || typeof a!=="object" || typeof b!=="object" || Array.isArray(a)!==Array.isArray(b)) return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k) && same(a[k],b[k]));
}

export async function verifyWaitcostReport(report,weights,bank) {
  if(report?.format!==WAITCOST_REPORT || report.suite!==WAITCOST_SUITE.id || !WAITCOST_EVALUATION_SPLITS.includes(report.split)) throw new Error("Unrecognized one-slot report or suite version.");
  const manifest=waitcostCases(report.split);
  if(!Array.isArray(report.cases) || report.cases.length!==manifest.length) throw new Error("Incomplete one-slot report.");
  for(const [i,config] of manifest.entries()) {
    const r=decodeWaitcostCase(report.split,report.cases[i]);
    if(r.seed!==config.seed || r.family!==config.family || r.priceCents!==config.priceCents) throw new Error("Report differs from the fixed seed, price or market manifest.");
  }
  let i=0;
  const replayed=await benchmarkWaitcost({split:report.split,policy:report.policy,weights,bank,createPolicy(){
    const {actions}=decodeWaitcostCase(report.split,report.cases[i++]);
    let j=0;return ()=>actions[j++];
  }});
  if(!same(replayed,report)) throw new Error("Reported charges, readings, decisions or scores differ from replay.");
  return replayed;
}
