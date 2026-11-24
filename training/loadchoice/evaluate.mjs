import assert from "node:assert/strict";
import { LOADCHOICE_PATTERNS, loadchoiceCases, createLoadchoice, observeLoadchoice, stepLoadchoice } from "../../docs/lib/loadchoice.js";
import { LOADCHOICE_KEYS, MATCHED_KEYS, loadchoiceReferences, referenceScores, scoringRow, summarizeLoadchoice, finishReference } from "../../docs/lib/loadchoice-benchmark.js";
import { scoreGroup } from "../../docs/lib/lastslot-benchmark.js";
import { chooseLoadchoice } from "../../docs/lib/loadchoice-policy.js";
import { LOADCHOICE_SUITE } from "../../docs/lib/loadchoice.js";

const targetGroups=["reversal/cold","interrupted-drop/hot"];
const groupOf=family=>{const p=LOADCHOICE_PATTERNS[family];return p.stratum+"/"+p.ending;};

function matchedScore(config,refs) {
  const state=createLoadchoice(config);
  let o=observeLoadchoice(state);
  while(o.phase!=="survey") o=stepLoadchoice(state,refs.tariff(o));
  if(o.slots!==1) return null;
  let mask=0;
  const nets=MATCHED_KEYS.map((key,index)=>{
    const score=finishReference(structuredClone(state),refs[key]);
    if(score.bought) mask|=1<<index;
    return score.netCents;
  });
  return [mask,...nets];
}

const loadCounts=()=>({runs:0,changed:0,higher:0,lower:0,equal:0,grossDeltaCents:0});
const empty=()=>({shifts:0,oneSlot:0,bought:0,feeCents:0,buyGainCents:0,forced:loadCounts(),purchases:loadCounts()});
function countLoad(bucket,changed,grossDelta) {
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
  if(!loadPair) {assert.equal(bought,false); return;}
  bucket.oneSlot++;
  const grossDelta=row.rlAlways+row.priceCents-row.rlNever;
  const changed=loadPair[0]!==loadPair[1];
  countLoad(bucket.forced,changed,grossDelta);
  if(bought) {
    bucket.bought++;
    bucket.feeCents+=row.priceCents;
    countLoad(bucket.purchases,changed,grossDelta);
  }
}
export function evaluateSplit(split,weights) {
  const refs=loadchoiceReferences(weights),scores=[],matched=[],slots=[],loads=[];
  const rows=[],gateRows=[],opportunities={},history=new Map();
  let lastTape;
  for(const config of loadchoiceCases(split)) {
    const tape=config.seed+"/"+config.family;
    if(tape!==lastTape) {history.clear();lastTape=tape;}
    const exposure={},packed=referenceScores(config,refs,history,exposure);
    const loadPair=exposure.oneSlot===1 ? [exposure.rlAlways,exposure.rlNever] : null;
    const matchedRow=matchedScore(config,refs);
    scores.push(packed);matched.push(matchedRow);slots.push(exposure.oneSlot);loads.push(loadPair);
    const row=scoringRow(config,LOADCHOICE_KEYS,packed);
    rows.push(row);
    if(matchedRow) gateRows.push(scoringRow(config,MATCHED_KEYS,matchedRow));
    for(const key of ["all",groupOf(config.family)]) {
      const group=opportunities[key]??={all:empty(),positive:empty(),byPrice:{}};
      countOpportunity(group.all,row,loadPair);
      if(config.priceCents>0) countOpportunity(group.positive,row,loadPair);
      countOpportunity(group.byPrice[config.priceCents]??=empty(),row,loadPair);
    }
  }
  const bank={suite:LOADCHOICE_SUITE.id,split,keys:LOADCHOICE_KEYS,scores,matched,slots,loads};
  return {bank,outcome:{summary:summarizeLoadchoice(rows,LOADCHOICE_KEYS),matched:summarizeLoadchoice(gateRows,MATCHED_KEYS,true),opportunities}};
}

// Every training replicate receives its own blind continuation and acquisition decisions.
export function fitScores(model,priors,bank) {
  const groups=Object.fromEntries(targetGroups.map(key=>[key,[]]));
  const using=mode=>o=>chooseLoadchoice(o,model,priors,mode);
  const optional=using("optional"),never=using("never"),plannerIndex=1+LOADCHOICE_KEYS.indexOf("planner");
  for(const [i,c] of loadchoiceCases("test").entries()) {
    const group=groups[groupOf(c.family)];
    if(!group || !c.priceCents) continue;
    const score=finishReference(createLoadchoice(c),optional);
    const blind=score.bought ? finishReference(createLoadchoice(c),never).netCents : score.netCents;
    group.push({...c,net:score.netCents,rlNever:blind,planner:bank.scores[i][plannerIndex],
      purchased:score.bought,mask:(bank.scores[i][0]&(1<<(plannerIndex-1))) ? 2 : 0});
  }
  return Object.fromEntries(Object.entries(groups).map(([k,rows])=>[k,scoreGroup(rows,["rlNever","planner"])]));
}
export function assess(splits,margin) {
  const groups=splits.test.summary.positiveByStratumEnding,original=splits.retention.summary.all.references;
  const wins=group=>["rlNever","planner"].every(key=>group.references[key].interval95[0]>0);
  const coldReversals=wins(groups.reversal.cold),hotDrops=wins(groups["interrupted-drop"].hot);
  const originalDrop=["stochastic","booking","survey"].every(key=>original[key].interval95[0]>0) &&
    ["lastslot","tariff","paid","rally","trust","drift","turns"].every(key=>original[key].interval95[0]>-margin);
  return {hotDrops,coldReversals,originalDrop,joint:hotDrops&&coldReversals&&originalDrop};
}

export function chooseExamples(bank) {
  const manifest=loadchoiceCases("test"),selected=[];
  const forcedIndex=1+LOADCHOICE_KEYS.indexOf("rlAlways"),skipIndex=1+LOADCHOICE_KEYS.indexOf("rlNever");
  for(const target of targetGroups) {
    const buckets=new Map();
    for(const [i,c] of manifest.entries()) {
      if(!c.priceCents || !bank.loads[i] || groupOf(c.family)!==target) continue;
      const scores=bank.scores[i],bought=Boolean(scores[0]&1);
      const deltaCents=scores[forcedIndex]-scores[skipIndex],grossDeltaCents=deltaCents+c.priceCents;
      const [buyWave,skipWave]=bank.loads[i],sign=Math.sign(grossDeltaCents);
      const old=buckets.get(sign);
      if(!old || (bought && !old.bought)) {
        const {stratum,ending}=LOADCHOICE_PATTERNS[c.family];
        buckets.set(sign,{...c,stratum,ending,bought,deltaCents,grossDeltaCents,buyWave,skipWave});
      }
    }
    const directional=[buckets.get(1),buckets.get(-1)].filter(Boolean);
    selected.push(...(directional.length ? directional : [buckets.get(0)].filter(Boolean)));
  }
  return selected;
}
