import {bestFleetAction, fleetPlannerContinuation} from "./fleetweek-planner.js";
import {isOvernight} from "./overnight-policy.js";
import {overrideContext, overrideEstimates, overrideExample, selectOverride} from "./override-policy.js";

const leader = row => row.indexOf(Math.max(...row));
const dot = (weights,x) => weights.reduce((sum,w,i) => sum + w*x[i],0);

// A frame caches only information already published when the decision is made.
// Training can reuse it for different hypothetical starting truck positions.
export function uncertaintyFrame(obs) {
  const base = fleetPlannerContinuation(obs);
  return {obs, base, context:isOvernight(obs.epoch) ? overrideContext(obs,base) : null};
}

export function candidateOnFrame(frame, menu, predecessor) {
  const {obs,base,context} = frame;
  const plannerId = bestFleetAction(menu,base);
  const planner = menu.find(a=>a.id===plannerId);
  if (!context) return {planner,proposal:null};
  const prior = selectOverride(plannerId,overrideEstimates(context,menu,planner,predecessor),predecessor.settings);
  if (prior.chosenId===plannerId) return {planner,proposal:null};
  const proposal=menu.find(a=>a.id===prior.chosenId);
  const {features}=overrideExample(context,planner,proposal);
  const calls=obs.forecast.map(leader);
  const history=[...obs.history.map(h=>h.hub),obs.hub];
  const t=obs.epoch, next=t+1, later=t+2;
  const vote=hub=> Number(proposal.positions.includes(hub))-Number(planner.positions.includes(hub));
  const historyVotes=history.map(vote);
  const recent=historyVotes.slice(-3);
  const shift=proposal.emptyCost-planner.emptyCost;
  const evidence=[
    Number(shift>0),Number(shift<0),Number(shift===0), (7-t)/6, context.agreement,context.reliability,
    prior.netGain/25,prior.serviceGain,Math.abs(shift)/20,
    vote(calls[next]),vote(calls[later]),vote(history.at(-1)),vote(history.at(-2)),vote(history[0]),
    recent.reduce((s,n)=>s+n,0)/recent.length,historyVotes.reduce((s,n)=>s+n,0)/history.length,
    Number(calls[next]===calls[later]),Number(history.at(-1)===calls[t]),Number(calls[next]===history[0]),
    Number(calls[next]===history.at(-1)),Number(history.at(-1)===history.at(-2)),
    Number(proposal.positions[0]===proposal.positions[1]),Number(planner.positions[0]===planner.positions[1]),
  ];
  // Include type-by-evidence interactions: cancelling a reposition and sending
  // an extra truck can have different losses at the same predicted advantage.
  const direction=Math.sign(shift);
  const x=[...features,...evidence,...evidence.slice(9,21).map(v=>v*direction)];
  const riskX=[1,...evidence,...evidence.map(v=>v*direction),
    Math.abs(vote(calls[next])-vote(history.at(-1))),Number(calls[next]!==calls[later])*(7-t)/6];
  return {planner, proposal, priorNetGain:prior.netGain,priorServiceGain:prior.serviceGain,x,riskX};
}

export function conditionalMeans(candidate, model) {
  return {riskMean:candidate.priorNetGain+dot(model.net,candidate.x),
    fittedService:candidate.priorServiceGain+dot(model.service,candidate.x)};
}

export function downsideFeatures(candidate, means) {
  return [...candidate.riskX,means.riskMean/30, Math.abs(means.riskMean)/30,
    means.fittedService, Math.abs(means.fittedService)];
}

export function estimateCandidate(candidate, model) {
  if (!candidate.proposal) return null;
  const means=conditionalMeans(candidate,model);
  return {...means,priorNetGain:candidate.priorNetGain,priorServiceGain:candidate.priorServiceGain,
    downside:Math.max(0,dot(model.downside,downsideFeatures(candidate,means)))};
}

export function uncertaintyDecision(candidate,estimate,settings,flatDownside,options={}) {
  const plannerId=candidate.planner.id;
  if (!estimate) return {plannerId,proposalId:null,chosenId:plannerId,netGain:null,serviceGain:null,
    priorNetGain:null,riskMean:null,downside:null,penalty:null,score:null,riskVeto:false};
  const proposalId=candidate.proposal.id;
  const {downside,riskMean,priorNetGain,priorServiceGain,fittedService}=estimate;
  const netGain=priorNetGain + settings.blend*(riskMean-priorNetGain);
  const serviceGain=priorServiceGain + settings.blend*(fittedService-priorServiceGain);
  const expected=netGain+settings.serviceCredit*serviceGain;
  const penalty=options.meanOnly ? 0 : settings.lambda*(options.flatRisk ? flatDownside : downside);
  const score=expected-penalty;
  const override=!settings.plannerOnly && score>0;
  return {plannerId,proposalId,chosenId:override ? proposalId : plannerId,netGain,serviceGain,
    priorNetGain,riskMean,downside,penalty,score,riskVeto:!settings.plannerOnly && expected>0 && !override};
}

export function inspectUncertainty(obs, menu, model, predecessor, options={}) {
  const candidate=candidateOnFrame(uncertaintyFrame(obs),menu,predecessor);
  return uncertaintyDecision(candidate,estimateCandidate(candidate,model),model.settings,model.flatDownside,options);
}

export function makeUncertaintyPolicy(model,predecessor,options={}) {
  return (obs,menu)=>inspectUncertainty(obs,menu,model,predecessor,options).chosenId;
}
