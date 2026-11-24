import assert from "node:assert/strict";
import { WAITCOST_PATTERNS, waitcostCases, createWaitcost, observeWaitcost, stepWaitcost } from "../../docs/lib/waitcost.js";
import { WAITCOST_KEYS, MATCHED_KEYS, waitcostReferences, referenceScores, scoringRow, summarizeWaitcost, finishReference } from "../../docs/lib/waitcost-benchmark.js";
import { scoreGroup } from "../../docs/lib/lastslot-benchmark.js";
import { chooseWaitcost } from "../../docs/lib/waitcost-policy.js";
import { WAITCOST_SUITE } from "../../docs/lib/waitcost.js";

const targetGroups=["reversal/cold","interrupted-drop/hot"];
const groupOf=family=>{const p=WAITCOST_PATTERNS[family];return p.stratum+"/"+p.ending;};

function matchedScore(config,refs) {
  const state=createWaitcost(config);
  let o=observeWaitcost(state);
  while(o.phase!=="survey") o=stepWaitcost(state,refs.tariff(o));
  if(o.slots!==1) return null;
  let mask=0;
  const nets=MATCHED_KEYS.map((key,index)=>{
    const score=finishReference(structuredClone(state),refs[key]);
    if(score.bought) mask|=1<<index;
    return score.netCents;
  });
  return [mask,...nets];
}

const loadCounts=()=>({runs:0,changed:0,higher:0,lower:0,equal:0,grossDeltaCents:0,
  wait:{unguardedLater:0,unguardedHarmful:0,unguardedBeneficial:0,guardedLater:0,guardedHarmful:0,guardedBeneficial:0,
    interventions:0,saved:0,costly:0,tied:0,guardGainCents:0,
    opportunitiesToStop:0,worthwhileStops:0,missedSavings:0,unnecessaryStops:0,blanketGainCents:0}});
const empty=()=>({shifts:0,oneSlot:0,bought:0,feeCents:0,buyGainCents:0,forced:loadCounts(),purchases:loadCounts()});
function countDelay(outcome,key,wave,blindWave,grossDelta) {
  // Wave zero denotes an empty slot at close, after every freight offer.
  if((wave || 9)<=(blindWave || 9)) return;
  outcome[key+"Later"]++;
  if(grossDelta<0) outcome[key+"Harmful"]++;
  if(grossDelta>0) outcome[key+"Beneficial"]++;
}
function countLoad(bucket,loadPair,row) {
  const [guarded,blind,unguarded,blanket]=loadPair;
  const changed=guarded!==blind;
  const grossDelta=row.rlAlways+row.priceCents-row.rlNever;
  const unguardedGrossDelta=row.unguardedAlways+row.priceCents-row.rlNever;
  const gain=row.rlAlways-row.unguardedAlways;
  countDelay(bucket.wait,"guarded",guarded,blind,grossDelta);
  countDelay(bucket.wait,"unguarded",unguarded,blind,unguardedGrossDelta);
  const blanketGain=row.alwaysStopForced-row.unguardedAlways;
  bucket.wait.blanketGainCents+=blanketGain;
  if(blanket!==unguarded) {
    bucket.wait.opportunitiesToStop++;
    if(blanketGain>0) {
      bucket.wait.worthwhileStops++;
      if(guarded===unguarded) bucket.wait.missedSavings++;
    }
  } else assert.equal(blanketGain,0);
  bucket.wait.guardGainCents+=gain;
  if(guarded!==unguarded) {
    assert((guarded || 9)<(unguarded || 9),"The guard can only shorten a wait.");
    bucket.wait.interventions++;
    if(gain<=0) bucket.wait.unnecessaryStops++;
    if(gain>0) bucket.wait.saved++;
    else if(gain<0) bucket.wait.costly++;
    else bucket.wait.tied++;
  } else assert.equal(gain,0);
  bucket.runs++;
  bucket.grossDeltaCents+=grossDelta;
  if(changed) {
    bucket.changed++;
    if(grossDelta>0) bucket.higher++;
    else if(grossDelta<0) bucket.lower++;
    else bucket.equal++;
  } else assert.equal(grossDelta,0);
}
function countOpportunity(bucket,row,loadPair) {
  const bought=row.purchased;
  bucket.shifts++;
  bucket.buyGainCents+=row.rl-row.rlNever;
  assert.equal(row.rl,bought ? row.rlAlways : row.rlNever);
  assert.equal(row.unguarded,bought ? row.unguardedAlways : row.rlNever);
  assert.equal(row.alwaysStop,bought ? row.alwaysStopForced : row.rlNever);
  if(!loadPair) {assert.equal(bought,false); return;}
  bucket.oneSlot++;
  countLoad(bucket.forced,loadPair,row);
  if(bought) {
    bucket.bought++;
    bucket.feeCents+=row.priceCents;
    countLoad(bucket.purchases,loadPair,row);
  }
}
export function evaluateSplit(split,weights) {
  const refs=waitcostReferences(weights),scores=[],matched=[],slots=[],loads=[];
  const rows=[],gateRows=[],opportunities={},history=new Map();
  let lastTape;
  for(const config of waitcostCases(split)) {
    const tape=config.seed+"/"+config.family;
    if(tape!==lastTape) {history.clear();lastTape=tape;}
    const exposure={},packed=referenceScores(config,refs,history,exposure);
    const loadPair=exposure.oneSlot===1 ? [exposure.rlAlways,exposure.rlNever,exposure.unguardedAlways,exposure.alwaysStopForced] : null;
    const matchedRow=matchedScore(config,refs);
    scores.push(packed);matched.push(matchedRow);slots.push(exposure.oneSlot);loads.push(loadPair);
    const row=scoringRow(config,WAITCOST_KEYS,packed);
    rows.push(row);
    if(matchedRow) gateRows.push(scoringRow(config,MATCHED_KEYS,matchedRow));
    for(const key of ["all",groupOf(config.family)]) {
      const group=opportunities[key]??={all:empty(),positive:empty(),byPrice:{}};
      countOpportunity(group.all,row,loadPair);
      if(config.priceCents>0) countOpportunity(group.positive,row,loadPair);
      countOpportunity(group.byPrice[config.priceCents]??=empty(),row,loadPair);
    }
  }
  const bank={suite:WAITCOST_SUITE.id,split,keys:WAITCOST_KEYS,scores,matched,slots,loads};
  return {bank,outcome:{summary:summarizeWaitcost(rows,WAITCOST_KEYS),matched:summarizeWaitcost(gateRows,MATCHED_KEYS,true),opportunities}};
}

// Every training replicate receives its own blind continuation and acquisition decisions.
export function fitScores(model,priors,bank) {
  const groups=Object.fromEntries(targetGroups.map(key=>[key,[]]));
  const using=mode=>o=>chooseWaitcost(o,model,priors,mode);
  const optional=using("optional"),never=using("never"),plannerIndex=1+WAITCOST_KEYS.indexOf("planner");
  for(const [i,c] of waitcostCases("test").entries()) {
    const group=groups[groupOf(c.family)];
    if(!group || !c.priceCents) continue;
    const score=finishReference(createWaitcost(c),optional);
    const blind=score.bought ? finishReference(createWaitcost(c),never).netCents : score.netCents;
    group.push({...c,net:score.netCents,rlNever:blind,planner:bank.scores[i][plannerIndex],
      purchased:score.bought,mask:(bank.scores[i][0]&(1<<(plannerIndex-1))) ? 2 : 0});
  }
  return Object.fromEntries(Object.entries(groups).map(([k,rows])=>[k,scoreGroup(rows,["rlNever","planner"])]));
}
export function assess(splits,margin) {
  const groups=splits.test.summary.positiveByStratumEnding,original=splits.retention.summary.all.references;
  const wins=group=>["rlNever","planner"].every(key=>group.references[key].interval95[0]>0);
  const coldReversals=wins(groups.reversal.cold),hotDrops=groups["interrupted-drop"].hot.references.planner.interval95[0]>0;
  const originalDrop=["stochastic","booking","survey"].every(key=>original[key].interval95[0]>0) &&
    ["loadchoice","lastslot","tariff","paid","rally","trust","drift","turns"].every(key=>original[key].interval95[0]>-margin);
  return {hotDrops,coldReversals,originalDrop,joint:hotDrops&&coldReversals&&originalDrop};
}

// For each target show the first useful and costly interventions, preferring
// actual paid choices. If the rule never intervenes, disclose that and show
// representative profitable/costly deferrals, or one unchanged booking.
export function chooseExamples(bank) {
  const manifest=waitcostCases("test"),examples=[];
  const index=key=>1+WAITCOST_KEYS.indexOf(key);
  for(const target of targetGroups) {
    const first=new Map();
    for(const [i,c] of manifest.entries()) {
      if(!c.priceCents || !bank.loads[i] || groupOf(c.family)!==target) continue;
      const scores=bank.scores[i],bought=Boolean(scores[0]&1);
      const [buyWave,skipWave,unguardedWave]=bank.loads[i];
      const guardGainCents=scores[index("rlAlways")]-scores[index("unguardedAlways")];
      const deltaCents=scores[index("rlAlways")]-scores[index("rlNever")];
      const grossDeltaCents=deltaCents+c.priceCents;
      let reason="unchanged";
      if(buyWave!==unguardedWave) reason=guardGainCents>0?"saved":guardGainCents<0?"costly":"tied";
      else if((buyWave || 9)>(skipWave || 9)) reason=grossDeltaCents<0?"harmful-wait":"other-wait";
      if(!first.has(reason) || (bought && !first.get(reason).bought)) {
        const {stratum,ending}=WAITCOST_PATTERNS[c.family];
        first.set(reason,{...c,stratum,ending,bought,deltaCents,grossDeltaCents,buyWave,skipWave,unguardedWave,guardGainCents,reason});
      }
    }
    const intervened=["saved","costly","tied"].map(key=>first.get(key)).filter(Boolean);
    const remaining=["harmful-wait","other-wait","unchanged"].map(key=>first.get(key)).filter(Boolean);
    examples.push(...[...intervened,...remaining].slice(0,2));
  }
  return examples;
}
