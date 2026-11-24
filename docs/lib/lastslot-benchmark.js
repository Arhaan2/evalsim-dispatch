import { LASTSLOT_PATTERNS, LASTSLOT_SUITE, lastslotCases, createLastslot, observeLastslot,
  stepLastslot, verifyLastslot, lastslotCalls } from "./lastslot.js";
import { chooseLastslot } from "./lastslot-policy.js";
import { tariffWeights, tariffReferences } from "./tariff-benchmark.js";
import { pairedReserve } from "./reserve-policy.js";

export const LASTSLOT_REPORT="evalsim-lastslot-report-v1";
export const LASTSLOT_EVALUATION_SPLITS=Object.freeze(["validation","test","retention","archive"]);
export const LASTSLOT_KEYS=Object.freeze(["rl","rlNever","planner","rlAlways","tariff","paid","stochastic","booking","survey","rally","trust","drift","turns"]);
export const MATCHED_KEYS=Object.freeze(["rl","rlNever","planner"]);
export const lastslotWeights=(release,...previous)=>({...tariffWeights(...previous),lastslot:release.checkpoint.weights});

export function lastslotReferences(weights) {
  const earlier=tariffReferences(weights);
  const learner=mode=>o=>chooseLastslot(o,weights.lastslot,weights,mode);
  return {rl:learner("optional"),rlNever:learner("never"),planner:earlier.planner,rlAlways:learner("always"),
    tariff:earlier.rl,paid:earlier.paid,...Object.fromEntries(LASTSLOT_KEYS.slice(6).map(k=>[k,earlier[k]]))};
}

export async function runLastslotCase(config,decide) {
  if(typeof decide!=="function") throw new TypeError("Expected a policy function.");
  const state=createLastslot(config),actions=[];
  let o=observeLastslot(state);
  while(!o.done) {
    const action=await decide(o,lastslotCalls(o));
    o=stepLastslot(state,action);
    actions.push(action);
  }
  const score=verifyLastslot(state);
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

// Store integer-cent differences until the final display conversion. Intervals
// resample complete seeds, keeping all prices and sibling markets together.
export function scoreGroup(rows,keys) {
  const n=rows.length;
  if(!n) throw new Error("No cases in the requested score group.");
  const seeds=new Set(),tapes=new Set();
  let net=0,bought=0,fees=0;
  for(const r of rows) {
    seeds.add(r.seed);tapes.add(r.seed+"/"+r.family);net+=r.net;
    if(r.purchased) { bought++;fees+=r.priceCents; }
  }
  const references={};
  for(const [i,k] of keys.entries()) {
    let total=0,count=0,charges=0;
    for(const r of rows) {
      total+=r[k];
      if(r.mask & (1<<i)) { count++;charges+=r.priceCents; }
    }
    const pair=pairedReserve(rows,"net",k);
    references[k]={mean:total/(100*n),bought:count,fees:charges/100,...pair,
      delta:pair.delta/100,interval95:pair.interval95.map(x=>x/100)};
  }
  return {shifts:n,tapes:tapes.size,seeds:seeds.size,mean:net/(100*n),bought,fees:fees/100,references};
}

export function summarizeLastslot(rows,keys,matched=false) {
  const group=part=>scoreGroup(part,keys);
  const stratum=r=>LASTSLOT_PATTERNS[r.family].stratum,ending=r=>LASTSLOT_PATTERNS[r.family].ending;
  const joint=part=>groupBy(part,stratum,section=>groupBy(section,ending,group));
  const positive=rows.filter(r=>r.priceCents>0);
  const core={all:group(rows),positive:group(positive),positiveByStratumEnding:joint(positive)};
  if(matched) return core;
  return {...core,byFamily:groupBy(rows,r=>r.family,group),byStratum:groupBy(rows,stratum,group),byEnding:groupBy(rows,ending,group),
    byStratumEnding:joint(rows),byPrice:groupBy(rows,r=>r.priceCents,p=>({all:group(p),byStratumEnding:joint(p)}))};
}

export function finishReference(state,decide) {
  let o=observeLastslot(state);
  let gateSlots=null;
  while(!o.done) {
    if(o.phase==="survey") gateSlots=o.slots;
    o=stepLastslot(state,decide(o));
  }
  const score=verifyLastslot(state);
  if(score.violations.length) throw new Error("Reference ledger failed to reconcile.");
  return {...score,gateSlots};
}

export function referenceScores(config,refs,history,exposure) {
  let mask=0;
  const scores=[];
  for(const [i,k] of LASTSLOT_KEYS.entries()) {
    // Historical zero-purchase rules have identical scores across tariffs.
    let score=i>=6 ? history.get(k) : null;
    if(!score) {
      score=finishReference(createLastslot(config),refs[k]);
      if(i>=6) history.set(k,score);
    }
    if(exposure && k==="rl") exposure.oneSlot=score.gateSlots;
    if(score.bought) mask|=1<<i;
    scores.push(score.netCents);
  }
  return [mask,...scores];
}

export function scoringRow(config,keys,packed,net=packed[1],purchased=Boolean(packed[0]&1)) {
  return {...config,net,purchased,mask:packed[0],...Object.fromEntries(keys.map((k,i)=>[k,packed[i+1]]))};
}

function packCandidate(config, familyIndex, actions, score) {
  const mask=actions.reduce((bits,action,i)=>bits|((action==="accept" || action==="buy" ? 1 : 0)<<i),0);
  return [config.seed,familyIndex,config.priceCents,mask,score.netCents,score.feeCents,score.reading];
}
export function decodeLastslotCase(split,row) {
  if(!Array.isArray(row) || row.length!==7 || !Number.isInteger(row[3]) || row[3]<0 || row[3]>511) throw new RangeError("Invalid packed nine-action record.");
  const [seed,familyIndex,priceCents,mask,netCents,feeCents,reading]=row;
  const family=LASTSLOT_SUITE.splits[split].families[familyIndex];
  const actions=Array.from({length:9},(_,i)=>mask&(1<<i) ? (i===5?"buy":"accept"):(i===5?"skip":"pass"));
  return {seed,family,priceCents,actions,netCents,feeCents,grossCents:netCents+feeCents,reading,
    net:netCents/100,feePaid:feeCents/100,gross:(netCents+feeCents)/100};
}

export async function benchmarkLastslot({split="test",policy,createPolicy,weights,bank}) {
  if(!LASTSLOT_EVALUATION_SPLITS.includes(split)) throw new Error("Unknown one-slot split.");
  if(typeof policy!=="string" || !policy.trim() || policy.length>160) throw new Error("Use a policy name of 1–160 characters.");
  const manifest=lastslotCases(split),families=LASTSLOT_SUITE.splits[split].families,refs=lastslotReferences(weights);
  if(bank && (bank.suite!==LASTSLOT_SUITE.id || bank.split!==split || !same(bank.keys,LASTSLOT_KEYS) || bank.scores?.length!==manifest.length)) throw new Error("Incompatible reference bank.");
  const rows=[],cases=[],history=new Map();
  let lastTape;
  for(const [i,config] of manifest.entries()) {
    try {
      const tape=config.seed+"/"+config.family;
      if(lastTape!==tape) {history.clear();lastTape=tape;}
      const packed=bank ? bank.scores[i]:referenceScores(config,refs,history);
      const {actions,score}=await runLastslotCase(config,createPolicy());
      cases.push(packCandidate(config,families.indexOf(config.family),actions,score));
      rows.push(scoringRow(config,LASTSLOT_KEYS,packed,score.netCents,score.bought));
    } catch(err) { throw new Error(config.family+" seed "+config.seed+" at "+config.priceCents+" cents: "+err.message,{cause:err}); }
  }
  return {format:LASTSLOT_REPORT,suite:LASTSLOT_SUITE.id,split,policy,summary:summarizeLastslot(rows,LASTSLOT_KEYS),cases};
}

function same(a,b) {
  if(a===b) return true;
  if(!a || !b || typeof a!=="object" || typeof b!=="object" || Array.isArray(a)!==Array.isArray(b)) return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k) && same(a[k],b[k]));
}

export async function verifyLastslotReport(report,weights,bank) {
  if(report?.format!==LASTSLOT_REPORT || report.suite!==LASTSLOT_SUITE.id || !LASTSLOT_EVALUATION_SPLITS.includes(report.split)) throw new Error("Unrecognized one-slot report or suite version.");
  const manifest=lastslotCases(report.split);
  if(!Array.isArray(report.cases) || report.cases.length!==manifest.length) throw new Error("Incomplete one-slot report.");
  for(const [i,config] of manifest.entries()) {
    const r=decodeLastslotCase(report.split,report.cases[i]);
    if(r.seed!==config.seed || r.family!==config.family || r.priceCents!==config.priceCents) throw new Error("Report differs from the fixed seed, price or market manifest.");
  }
  let i=0;
  const replayed=await benchmarkLastslot({split:report.split,policy:report.policy,weights,bank,createPolicy(){
    const {actions}=decodeLastslotCase(report.split,report.cases[i++]);
    let j=0;return ()=>actions[j++];
  }});
  if(!same(replayed,report)) throw new Error("Reported charges, readings, decisions or scores differ from replay.");
  return replayed;
}
