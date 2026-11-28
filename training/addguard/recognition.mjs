import {pairedSwitchCost} from "../switchcost/paired-cost.mjs";

// All policies see the same short-path disagreements and Friday branch payoffs.
export function recognize(rows,index=0) {
  const takes = {
    rl:r=>r.predictions[index].switched,
    previous:r=>r.previous.switched,
    original:r=>r.original.switched,
  };
  const profitable=rows.filter(r=>r.netGain>0).length;
  function outcome(take) {
    const accepted=rows.filter(take);
    const wins=accepted.filter(r=>r.netGain>0), losses=accepted.filter(r=>r.netGain<0);
    return {accepted:accepted.length,wins:wins.length,losses:losses.length,ties:accepted.length-wins.length-losses.length,
      winningCredits:wins.reduce((s,r)=>s+r.netGain,0),losingCredits:losses.reduce((s,r)=>s+r.netGain,0),
      precision:accepted.length ? wins.length/accepted.length : null, recall:profitable ? wins.length/profitable : null};
  }
  function pair(a,b) {
    return pairedSwitchCost(rows.map(r=>({...r,previous:{switched:takes[b](r)},predictions:[{switched:takes[a](r)}]})),0);
  }
  return {outcomes:Object.fromEntries(Object.entries(takes).map(([name,take])=>[name,outcome(take)])),
    vsParent:pair("rl","previous"),vsMoveRecall:pair("rl","original"),parentVsMoveRecall:pair("previous","original")};
}
export function recognitionGroups(rows,index=0) {
  return {all:recognize(rows,index),added:recognize(rows.filter(r=>r.guardEligible),index)};
}
export function chooseExamples(cases,index=0) {
  const first=new Map();
  for(const c of cases) for(const o of c.opportunities) {
    if (!o.guardEligible) continue;
    const prediction=o.predictions[index], kept=prediction.switched;
    const change=kept ? "retained" : "vetoed";
    const outcome=o.netGain<0 ? "loss" : o.netGain>0 ? "win" : "tie";
    if (!first.has(change+outcome)) first.set(change+outcome,{
      family:c.family,seed:c.seed,closure:c.closure,duration:c.duration,epoch:o.epoch,status:o.status,
      change,outcome,guardRisk:prediction.guardRisk,guardEstimates:prediction.guardEstimates,
      previousChoiceId:o.longId,originalChoiceId:o.shortId,shortId:o.shortId,longId:o.longId,
      chosenId:kept ? o.longId : o.shortId,alternativeId:kept ? o.shortId : o.longId,
      chosen:kept ? o.alternative : c.shortGate,alternative:kept ? c.shortGate : o.alternative,
      longGain:o.netGain,netGain:kept ? o.netGain : -o.netGain,serviceGain:kept ? o.serviceGain : -o.serviceGain,
    });
  }
  return ["vetoed","retained"].flatMap(change=>["loss","win","tie"].flatMap(sign=>first.get(change+sign)??[]));
}
export function guardGoals(detection,fresh,archive) {
  const added=detection.added.vsParent, all=detection.all.vsParent;
  const goals={
    lossReduction:added.loss95!==null && added.loss95[0]>0,
    recall:all.recallDifference!==null && all.recallDifference>=0 && all.recall95!==null && all.recall95[0]>=0,
    freshShortProfit:fresh.earnsMoreThanShortGate,freshShortService:fresh.matchesShortGateService,
    freshFlatProfit:fresh.earnsMoreThanFlatRisk,freshFlatService:fresh.matchesFlatRiskService,
    freshProfit:fresh.earnsMoreThanPlanner,freshService:fresh.matchesPlannerService,doubleReturn:archive.earnsMoreThanPlanner,
  };
  return {...goals,joint:Object.values(goals).every(Boolean)};
}
