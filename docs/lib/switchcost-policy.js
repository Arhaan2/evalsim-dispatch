import {closureFrame} from "./closure-planner.js";
import {moveRecallProposal,moveRecallDecision} from "./moverecall-policy.js";

export const costHeads=["loss","win","downside","upside","service"];
export function costProposalFromRecall(frame,p,weights) {
  const recallEstimate=moveRecallDecision(p,weights.recall);
  const recallId=recallEstimate.chosenId,recallAccepted=p.rescueEligible && recallId===p.longId;
  let costX=null;
  if (p.rescueEligible) {
    const r=recallEstimate,h=p.previous;
    const prior=[r.winProbability,r.expectedNet,r.expectedDownside,r.expectedService];
    const daysLeft=(9-frame.obs.epoch)/9;
    const age=Math.max(0,frame.obs.epoch-frame.obs.incident.start);
    costX=[1,...prior,r.score,h.winProbability,h.expectedNet,(1-h.winProbability)*h.lossIfNonwin,h.expectedService,
      daysLeft,age,...p.x.slice(-6),Number(recallAccepted),...prior.map(v=>Number(recallAccepted)*v)];
  }
  return {...p,recallEstimate,recallId,recallAccepted,costX};
}
export function switchCostProposal(frame,menu,weights,prepared) {
  return costProposalFromRecall(frame,moveRecallProposal(frame,menu,weights,prepared),weights);
}
export function costRaw(x,model) {
  const z=x.map((v,j)=>j===0 ? 1 : (v-model.center[j])/model.scale[j]);
  return costHeads.map(h=>model.heads[h].reduce((s,c,j)=>s+c*z[j],0));
}
export function switchCostEstimates(p,model,{flatGate=false}={}) {
  if (!p.rescueEligible) {
    const r=p.recallEstimate;
    return {winProbability:r.winProbability,lossProbability:null,expectedNet:r.expectedNet,
      expectedDownside:r.expectedDownside,expectedUpside:r.expectedNet+r.expectedDownside,expectedService:r.expectedService};
  }
  const raw=flatGate ? null : costRaw(p.costX,model);
  const [l,w,d,u,expectedService]=costHeads.map((h,j)=>{
    const c=model.calibration[h];return raw ? c.mean+c.slope*(raw[j]-c.predictedMean) : c.mean;
  });
  const bound=v=>Math.max(0,Math.min(1,v));
  const mass=Math.max(1,bound(l)+bound(w));
  const lossProbability=bound(l)/mass,winProbability=bound(w)/mass,expectedDownside=Math.max(0,d),expectedUpside=Math.max(0,u);
  return {winProbability,lossProbability,expectedDownside,expectedUpside,expectedNet:expectedUpside-expectedDownside,expectedService};
}
export function costScore(e) {
  return e.expectedNet+12*e.expectedService+6*e.winProbability-12*e.lossProbability;
}
export function chooseSwitchCost(p,e,settings) {
  const score=p.rescueEligible ? costScore(e) : null;
  const vetoed=p.recallAccepted && settings.vetoFraction>0 && score<settings.vetoBelow;
  const added=p.rescueEligible && !p.recallAccepted && settings.addFraction>0 && score>settings.addAbove;
  return {...e,score,eligible:p.eligible,rescueEligible:p.rescueEligible,recallAccepted:p.recallAccepted,
    previousId:p.previousId,recallId:p.recallId,shortId:p.shortId,longId:p.longId,closureId:p.closureId,
    plannerId:p.plannerId,constantId:p.constantId,vetoed,added,chosenId:vetoed ? p.shortId : added ? p.longId : p.recallId};
}
export function switchCostDecision(p,model,options) {
  return chooseSwitchCost(p,switchCostEstimates(p,model,options),model.settings);
}
export function inspectSwitchCost(obs,menu,model,weights,options) {
  return switchCostDecision(switchCostProposal(closureFrame(obs),menu,weights),model,options);
}
export function makeSwitchCostPolicy(model,weights,options) {
  return (obs,menu)=>inspectSwitchCost(obs,menu,model,weights,options).chosenId;
}
