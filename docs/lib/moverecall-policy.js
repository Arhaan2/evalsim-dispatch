// Only an earlier detector's skipped disagreement can trigger a rescue.
// Similarity and reward estimates come from actual training cases on short's path.
import {closureFrame} from "./closure-planner.js";
import {longMoveProposal,longMoveDecision} from "./longmove-policy.js";

export const recallHeads=["win","net","downside","service"];
export function moveRecallProposal(frame,menu,weights,prepared) {
  const p=longMoveProposal(frame,menu,weights,prepared);
  const previous=longMoveDecision(p,weights.previous);
  return {...p,previous,previousId:previous.chosenId,rescueEligible:p.eligible && previous.chosenId===p.shortId};
}
export function recallFeatures(p) {
  const h=p.previous;
  return [...p.x.slice(1),h.winProbability,h.expectedNet,(1-h.winProbability)*h.lossIfNonwin,h.expectedService];
}
export function quantize(features,model) {
  return features.map((v,j)=>Math.round(32*Math.max(-4,Math.min(4,(v-model.center[j])/model.scale[j]))) || 0);
}
// Stable ties retain the earlier archived fitting observation.
export function neighborPrediction(x,model) {
  const k=Math.min(64,model.cases.length),best=[];
  let cutoff=Infinity;
  for (let i=0;i<model.cases.length;i++) {
    const row=model.cases[i];
    let d=0;
    for (let j=0;j<x.length && d<cutoff;j++) d+=model.metric[j]*(x[j]-row.x[j])**2;
    if (d>=cutoff) continue;
    let pos=best.length;
    while (pos>0 && best[pos-1].d>d) pos--;
    best.splice(pos,0,{i,d});
    if (best.length>k) best.pop();
    if (best.length===k) cutoff=best[k-1].d;
  }
  const sums=recallHeads.map(h=>16*model.means[h]);
  for (const {i} of best) {
    const row=model.cases[i];sums[0]+=Number(row.net>0);sums[1]+=row.net;
    sums[2]+=Math.max(0,-row.net);sums[3]+=row.service;
  }
  return sums.map(v=>v/(16+k));
}
export function moveRecallEstimates(p,model,{flatGate=false}={}) {
  if (!p.rescueEligible) {
    const h=p.previous;
    return {winProbability:h.winProbability,expectedNet:h.expectedNet,expectedService:h.expectedService,
      expectedDownside:p.eligible ? (1-h.winProbability)*h.lossIfNonwin : 0};
  }
  const raw=flatGate ? null : neighborPrediction(quantize(recallFeatures(p),model),model);
  const [prob,expectedNet,downside,expectedService]=recallHeads.map((h,j)=>{
    const c=model.calibration[h];
    return raw===null ? c.mean : c.mean+c.slope*(raw[j]-c.predictedMean);
  });
  return {winProbability:Math.max(.005,Math.min(.995,prob)),expectedNet,expectedDownside:Math.max(0,downside),expectedService};
}
export function chooseMoveRecall(p,e,settings) {
  const score=e.expectedNet+12*e.expectedService-settings.lossPenalty*e.expectedDownside;
  const rescued=p.rescueEligible && !settings.priorOnly && e.winProbability>=settings.minWin && score>settings.hurdle;
  return {...e,score,eligible:p.eligible,rescueEligible:p.rescueEligible,previousId:p.previousId,shortId:p.shortId,
    longId:p.longId,closureId:p.closureId,plannerId:p.plannerId,constantId:p.constantId,
    rescued,chosenId:rescued ? p.longId : p.previousId};
}
export function moveRecallDecision(p,model,options) {
  return chooseMoveRecall(p,moveRecallEstimates(p,model,options),model.settings);
}
export function inspectMoveRecall(obs,menu,model,weights,options) {
  return moveRecallDecision(moveRecallProposal(closureFrame(obs),menu,weights),model,options);
}
export function makeMoveRecallPolicy(model,weights,options) {
  return (obs,menu)=>inspectMoveRecall(obs,menu,model,weights,options).chosenId;
}
