import assert from "node:assert/strict";
import { LASTSLOT_PATTERNS,LASTSLOT_SUITE,lastslotCases,createLastslot,observeLastslot,stepLastslot } from "../../docs/lib/lastslot.js";
import { LASTSLOT_KEYS,MATCHED_KEYS,lastslotReferences,referenceScores,scoringRow,summarizeLastslot,finishReference } from "../../docs/lib/lastslot-benchmark.js";
import { chooseLastslot } from "../../docs/lib/lastslot-policy.js";

function matchedScore(config,refs) {
  const state=createLastslot(config);
  let o=observeLastslot(state);
  while(o.phase!=="survey") o=stepLastslot(state,refs.tariff(o));
  if(o.slots!==1) return null;
  let mask=0;
  const net=MATCHED_KEYS.map((k,i)=>{
    const score=finishReference(structuredClone(state),refs[k]);
    if(score.bought) mask|=1<<i;
    return score.netCents;
  });
  return [mask,...net];
}

const empty=()=>({shifts:0,oneSlot:0,bought:0,feeCents:0,buyGainCents:0});
function countOpportunities(bucket,row,slots) {
  const bought=row.purchased;
  bucket.shifts++;bucket.oneSlot+=Number(slots===1);bucket.bought+=Number(bought);
  if(bought) {assert.equal(slots,1);bucket.feeCents+=row.priceCents;}
  assert.equal(row.rl,bought ? row.rlAlways : row.rlNever);
  bucket.buyGainCents+=row.rl-row.rlNever;
}

export function evaluateSplit(split,weights) {
  const refs=lastslotReferences(weights), scores=[], matched=[], slots=[], opportunities={};
  const rows=[],gateRows=[],history=new Map();
  let tape;
  for(const config of lastslotCases(split)) {
    const id=config.seed+"/"+config.family;
    if(tape!==id) {history.clear();tape=id;}
    const exposure={}, packed=referenceScores(config,refs,history,exposure), gate=matchedScore(config,refs);
    scores.push(packed);matched.push(gate);slots.push(exposure.oneSlot);
    const row=scoringRow(config,LASTSLOT_KEYS,packed);
    rows.push(row);
    if(gate) gateRows.push(scoringRow(config,MATCHED_KEYS,gate));
    const p=LASTSLOT_PATTERNS[config.family];
    for(const key of ["all",p.stratum+"/"+p.ending]) {
      const g=opportunities[key]??={all:empty(),positive:empty(),byPrice:{}};
      countOpportunities(g.all,row,exposure.oneSlot);
      if(config.priceCents>0) countOpportunities(g.positive,row,exposure.oneSlot);
      countOpportunities(g.byPrice[config.priceCents]??=empty(),row,exposure.oneSlot);
    }
  }
  return {bank:{suite:LASTSLOT_SUITE.id,split,keys:LASTSLOT_KEYS,scores,slots,matched}, outcome:{
    summary:summarizeLastslot(rows,LASTSLOT_KEYS),matched:summarizeLastslot(gateRows,MATCHED_KEYS,true),opportunities}};
}

export function fitScores(split,model,priors) {
  const groups={};
  for(const config of lastslotCases(split)) {
    if(config.priceCents===0) continue;
    const score=finishReference(createLastslot(config),o=>chooseLastslot(o,model,priors));
    const p=LASTSLOT_PATTERNS[config.family];
    for(const key of ["all",p.stratum+"/"+p.ending]) {
      const g=groups[key]??={shifts:0,netCents:0,bought:0};
      g.shifts++;g.netCents+=score.netCents;g.bought+=Number(score.bought);
    }
  }
  for(const g of Object.values(groups)) g.mean=g.netCents/(g.shifts*100);
  return groups;
}

export function assess(splits,margin) {
  const f=splits.test.summary.positiveByStratumEnding, original=splits.retention.summary.all.references;
  const wins=g=>["rlNever","planner"].every(k=>g.references[k].interval95[0]>0);
  const hotDrops=wins(f["interrupted-drop"].hot), coldReversals=wins(f.reversal.cold);
  const originalDrop=["stochastic","booking","survey"].every(k=>original[k].interval95[0]>0)
    && ["tariff","paid","rally","trust","drift","turns"].every(k=>original[k].interval95[0]>-margin);
  return {hotDrops,coldReversals,originalDrop,joint:hotDrops&&coldReversals&&originalDrop};
}

export function chooseExamples(bank) {
  const manifest=lastslotCases("test"), candidates=[null,null];
  for(const [i,scores] of bank.scores.entries()) {
    const c=manifest[i];
    if(c.priceCents===0 || bank.slots[i]!==1) continue;
    const deltaCents=scores[1+LASTSLOT_KEYS.indexOf("rlAlways")]-scores[1+LASTSLOT_KEYS.indexOf("rlNever")];
    // A fee without a freight difference is a trivial costly example.
    if(!deltaCents || deltaCents===-c.priceCents) continue;
    const direction=deltaCents>0 ? 0 : 1,bought=Boolean(scores[0]&1);
    if(!candidates[direction] || (!candidates[direction].bought && bought)) {
      candidates[direction]={family:c.family,seed:c.seed,priceCents:c.priceCents,bought,deltaCents};
    }
    if(candidates.every(e=>e?.bought)) break;
  }
  return candidates.filter(Boolean);
}
