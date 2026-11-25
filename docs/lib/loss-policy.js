// Evaluate only the released override agent's actual proposal against its planner.
import {FLEET_PAIRS, fleetPairIndex, fleetWeekActions, fleetWeekBoardScenarios} from "./fleetweek.js";
import {bestFleetAction, fleetWeekHubProjection} from "./fleetweek-planner.js";
import {candidateOnFrame, estimateCandidate, uncertaintyDecision, uncertaintyFrame} from "./uncertainty-policy.js";

const dot = (weights, x) => weights.reduce((sum, w, i) => sum + w*x[i], 0);
const unit = n => Math.max(0, Math.min(1, n));
const morningBoards = fleetWeekBoardScenarios(0).map(board => ({
  hub:board.hub, weight:board.weight, best:FLEET_PAIRS.map(positions => {
    const menu = fleetWeekActions({positions, orders:board.orders});
    const id = bestFleetAction(menu, null);
    return menu.find(action => action.id === id);
  }),
}));
const nextHub = new WeakMap();
function morningOutlook(obs, planner, proposal) {
  let probability = nextHub.get(obs);
  if (!probability) {
    probability = fleetWeekHubProjection(obs)[obs.epoch + 1].map((p, h) =>
      0.68*p + 0.21*Number(obs.hub === h) + 0.11/3);
    nextHub.set(obs, probability);
  }
  let loss = 0, tie = 0, cost = 0, gain = 0, service = 0;
  const from = fleetPairIndex(planner.positions), to = fleetPairIndex(proposal.positions);
  for (const {hub, weight, best} of morningBoards) {
    const delta = proposal.net - planner.net + best[to].net - best[from].net;
    const p = weight * probability[hub];
    loss += p*Number(delta < 0);
    tie += p*Number(delta === 0);
    cost += p*Math.max(-delta, 0);
    gain += p*Math.max(delta, 0);
    service += p*(best[to].served - best[from].served);
  }
  return {loss:unit(loss), tie, cost:loss > 1e-8 ? cost/loss : 0,
    gain:1-loss > 1e-8 ? gain/(1-loss) : 0, service};
}

export function lossInputs(frame, candidate, uncertaintyModel) {
  if (!candidate.proposal) return null;
  const estimate = estimateCandidate(candidate, uncertaintyModel);
  const flat = uncertaintyDecision(candidate, estimate, uncertaintyModel.settings,
    uncertaintyModel.flatDownside, {flatRisk:true});
  const outlook = morningOutlook(frame.obs, candidate.planner, candidate.proposal);
  const nights = (7-frame.obs.epoch)/6;
  const shift = Math.sign(candidate.proposal.emptyCost-candidate.planner.emptyCost);
  const board = [outlook.loss, outlook.tie, outlook.cost/50, outlook.gain/50, outlook.service,
    flat.netGain/30, flat.serviceGain, estimate.downside/40];
  return {x:[...candidate.x, ...board, ...board.map(v => v*shift), ...board.map(v => v*nights)],
    outlook, legacyNet:flat.netGain, legacyService:flat.serviceGain, suffixId:flat.chosenId};
}

export function rawLossEstimate(inputs, model) {
  return unit(inputs.outlook.loss + dot(model.classLoss, inputs.x));
}

export function lossEstimate(inputs, model) {
  if (!inputs) return null;
  const rawProbability = rawLossEstimate(inputs, model);
  const bin = Math.min(9, Math.floor(10*rawProbability));
  return {rawProbability, lossProbability:model.calibratedBins[bin],
    lossSize:Math.max(0, inputs.outlook.cost + dot(model.lossAmount, inputs.x)),
    nonLossGain:Math.max(0, inputs.outlook.gain + dot(model.nonLossAmount, inputs.x)),
    serviceGain:inputs.legacyService + dot(model.service, inputs.x),
    legacyNet:inputs.legacyNet};
}

export function lossDecision(candidate, estimate, settings, globalLossRate, options={}) {
  const plannerId = candidate.planner.id;
  if (!estimate) return {plannerId, proposalId:null, chosenId:plannerId, lossProbability:null,
    usedProbability:null, rawProbability:null, lossSize:null, nonLossGain:null, expectedNet:null,
    serviceGain:null, score:null, flatScore:null};
  const proposalId = candidate.proposal.id;
  const {rawProbability, lossProbability, nonLossGain, lossSize, serviceGain, legacyNet} = estimate;
  const mean = p => (1-p)*nonLossGain-p*lossSize;
  const scoreAt = p => settings.blend*mean(p)+(1-settings.blend)*legacyNet+
    settings.serviceCredit*serviceGain-settings.hurdle;
  const usedProbability = options.flatLoss ? globalLossRate : lossProbability;
  const score = scoreAt(usedProbability);
  return {plannerId, proposalId, chosenId:!settings.plannerOnly && score>0 ? proposalId : plannerId,
    lossProbability, usedProbability, rawProbability, nonLossGain, lossSize, serviceGain,
    expectedNet:mean(usedProbability), score, flatScore:scoreAt(globalLossRate)};
}

export function inspectLoss(obs, menu, model, overrideFit13, uncertaintyFit13, options={}) {
  const frame = uncertaintyFrame(obs);
  const c = candidateOnFrame(frame, menu, overrideFit13);
  return lossDecision(c, lossEstimate(lossInputs(frame, c, uncertaintyFit13), model),
    model.settings, model.globalLossRate, options);
}
export function makeLossPolicy(model, overrideFit13, uncertaintyFit13, options={}) {
  return (obs, menu) => inspectLoss(obs, menu, model, overrideFit13, uncertaintyFit13, options).chosenId;
}
