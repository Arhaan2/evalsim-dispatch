import { LOADCHOICE_PATTERNS, LOADCHOICE_SUITE, loadchoiceCases, createLoadchoice, observeLoadchoice,
  stepLoadchoice, verifyLoadchoice, loadchoiceCalls } from "./loadchoice.js";
import { chooseLoadchoice } from "./loadchoice-policy.js";
import { lastslotWeights, lastslotReferences, scoreGroup, scoringRow } from "./lastslot-benchmark.js";
export { scoringRow };

export const LOADCHOICE_REPORT="evalsim-loadchoice-report-v1";
export const LOADCHOICE_EVALUATION_SPLITS=Object.freeze(["validation","test","retention","archive"]);
export const LOADCHOICE_KEYS=Object.freeze(["rl","rlNever","planner","rlAlways","lastslot","tariff","paid","stochastic","booking","survey","rally","trust","drift","turns"]);
export const MATCHED_KEYS=Object.freeze(["rl","rlNever","planner"]);
export const loadchoiceWeights=(release,...previous)=>({...lastslotWeights(...previous),loadchoice:release.checkpoint.weights});

export function loadchoiceReferences(weights) {
  const earlier=lastslotReferences(weights);
  const learner=mode=>o=>chooseLoadchoice(o,weights.loadchoice,weights,mode);
  return {rl:learner("optional"),rlNever:learner("never"),planner:earlier.planner,rlAlways:learner("always"),
    lastslot:earlier.rl,tariff:earlier.tariff,paid:earlier.paid,...Object.fromEntries(LOADCHOICE_KEYS.slice(7).map(k=>[k,earlier[k]]))};
}

export async function runLoadchoiceCase(config,decide) {
  if(typeof decide!=="function") throw new TypeError("Expected a policy function.");
  const state=createLoadchoice(config),actions=[];
  let o=observeLoadchoice(state);
  while(!o.done) {
    const action=await decide(o,loadchoiceCalls(o));
    o=stepLoadchoice(state,action);
    actions.push(action);
  }
  const score=verifyLoadchoice(state);
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

export function summarizeLoadchoice(rows,keys,matched=false) {
  const group=part=>scoreGroup(part,keys);
  const stratum=r=>LOADCHOICE_PATTERNS[r.family].stratum,ending=r=>LOADCHOICE_PATTERNS[r.family].ending;
  const joint=part=>groupBy(part,stratum,section=>groupBy(section,ending,group));
  const positive=rows.filter(r=>r.priceCents>0);
  const core={all:group(rows),positive:group(positive),positiveByStratumEnding:joint(positive)};
  if(matched) return core;
  return {...core,byFamily:groupBy(rows,r=>r.family,group),byStratum:groupBy(rows,stratum,group),byEnding:groupBy(rows,ending,group),
    byStratumEnding:joint(rows),byPrice:groupBy(rows,r=>r.priceCents,p=>({all:group(p),byStratumEnding:joint(p)}))};
}

export function finishReference(state,decide) {
  let o=observeLoadchoice(state);
  let gateSlots=null;
  while(!o.done) {
    if(o.phase==="survey") gateSlots=o.slots;
    o=stepLoadchoice(state,decide(o));
  }
  const score=verifyLoadchoice(state);
  if(score.violations.length) throw new Error("Reference ledger failed to reconcile.");
  const lateLoad=state.loads.find(load=>load.wave>=5);
  return {...score,gateSlots,loadWave:lateLoad ? lateLoad.wave+1 : 0};
}

export function referenceScores(config,refs,history,exposure) {
  let mask=0;
  const scores=[];
  for(const [i,k] of LOADCHOICE_KEYS.entries()) {
    // Historical zero-purchase rules have identical scores across tariffs.
    const priceIndependent=LOADCHOICE_KEYS.indexOf("stochastic")<=i;
    let score=priceIndependent ? history.get(k) : null;
    if(!score) {
      score=finishReference(createLoadchoice(config),refs[k]);
      if(priceIndependent) history.set(k,score);
    }
    if(exposure && k==="rl") exposure.oneSlot=score.gateSlots;
    if(exposure && (k==="rlAlways" || k==="rlNever")) exposure[k]=score.loadWave;
    if(score.bought) mask|=1<<i;
    scores.push(score.netCents);
  }
  return [mask,...scores];
}

function packCandidate(config, familyIndex, actions, score) {
  const mask=actions.reduce((bits,action,i)=>bits|((action==="accept" || action==="buy" ? 1 : 0)<<i),0);
  return [config.seed,familyIndex,config.priceCents,mask,score.netCents,score.feeCents,score.reading];
}
export function decodeLoadchoiceCase(split,row) {
  if(!Array.isArray(row) || row.length!==7 || !Number.isInteger(row[3]) || row[3]<0 || row[3]>511) throw new RangeError("Invalid packed nine-action record.");
  const [seed,familyIndex,priceCents,mask,netCents,feeCents,reading]=row;
  const family=LOADCHOICE_SUITE.splits[split].families[familyIndex];
  const actions=Array.from({length:9},(_,i)=>mask&(1<<i) ? (i===5?"buy":"accept"):(i===5?"skip":"pass"));
  return {seed,family,priceCents,actions,netCents,feeCents,grossCents:netCents+feeCents,reading,
    net:netCents/100,feePaid:feeCents/100,gross:(netCents+feeCents)/100};
}

export async function benchmarkLoadchoice({split="test",policy,createPolicy,weights,bank}) {
  if(!LOADCHOICE_EVALUATION_SPLITS.includes(split)) throw new Error("Unknown one-slot split.");
  if(typeof policy!=="string" || !policy.trim() || policy.length>160) throw new Error("Use a policy name of 1–160 characters.");
  const manifest=loadchoiceCases(split),families=LOADCHOICE_SUITE.splits[split].families,refs=loadchoiceReferences(weights);
  if(bank && (bank.suite!==LOADCHOICE_SUITE.id || bank.split!==split || !same(bank.keys,LOADCHOICE_KEYS) || bank.scores?.length!==manifest.length)) throw new Error("Incompatible reference bank.");
  const rows=[],cases=[],history=new Map();
  let lastTape;
  for(const [i,config] of manifest.entries()) {
    try {
      const tape=config.seed+"/"+config.family;
      if(lastTape!==tape) {history.clear();lastTape=tape;}
      const packed=bank ? bank.scores[i]:referenceScores(config,refs,history);
      const {actions,score}=await runLoadchoiceCase(config,createPolicy());
      cases.push(packCandidate(config,families.indexOf(config.family),actions,score));
      rows.push(scoringRow(config,LOADCHOICE_KEYS,packed,score.netCents,score.bought));
    } catch(err) { throw new Error(config.family+" seed "+config.seed+" at "+config.priceCents+" cents: "+err.message,{cause:err}); }
  }
  return {format:LOADCHOICE_REPORT,suite:LOADCHOICE_SUITE.id,split,policy,summary:summarizeLoadchoice(rows,LOADCHOICE_KEYS),cases};
}

function same(a,b) {
  if(a===b) return true;
  if(!a || !b || typeof a!=="object" || typeof b!=="object" || Array.isArray(a)!==Array.isArray(b)) return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k) && same(a[k],b[k]));
}

export async function verifyLoadchoiceReport(report,weights,bank) {
  if(report?.format!==LOADCHOICE_REPORT || report.suite!==LOADCHOICE_SUITE.id || !LOADCHOICE_EVALUATION_SPLITS.includes(report.split)) throw new Error("Unrecognized one-slot report or suite version.");
  const manifest=loadchoiceCases(report.split);
  if(!Array.isArray(report.cases) || report.cases.length!==manifest.length) throw new Error("Incomplete one-slot report.");
  for(const [i,config] of manifest.entries()) {
    const r=decodeLoadchoiceCase(report.split,report.cases[i]);
    if(r.seed!==config.seed || r.family!==config.family || r.priceCents!==config.priceCents) throw new Error("Report differs from the fixed seed, price or market manifest.");
  }
  let i=0;
  const replayed=await benchmarkLoadchoice({split:report.split,policy:report.policy,weights,bank,createPolicy(){
    const {actions}=decodeLoadchoiceCase(report.split,report.cases[i++]);
    let j=0;return ()=>actions[j++];
  }});
  if(!same(replayed,report)) throw new Error("Reported charges, readings, decisions or scores differ from replay.");
  return replayed;
}
