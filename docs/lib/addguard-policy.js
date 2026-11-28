import {closureFrame} from "./closure-planner.js";
import {closureActions, closureProbabilities} from "./closure-world.js";
import {fleetWeekBoardScenarios} from "./fleetweek.js";
import {fleetWeekHubProjection} from "./fleetweek-planner.js";
import {switchCostDecision, switchCostProposal} from "./switchcost-policy.js";

export const guardHeads = ["loss", "win", "downside", "upside", "service"];
export const guardFeatures = [
  "intercept", "parentScore", "parentLoss", "parentWin", "parentDownside", "parentUpside",
  "parentService", "recallScore", "earlierWin", "timeRemaining", "repairAge", "warning",
  "delayedUpdate", "closedNext", "closedLater", "immediateNet", "immediateService",
  "nextLossProbability", "nextWinProbability", "nextDownside", "nextUpside",
  "nextCoverLost", "nextCoverGained", "openNextNet", "closedNextNet", "laterHubCoverage",
  "nextLossNearFriday", "coveredClosureRisk",
];

const bestByMenu = new WeakMap();
function immediateValues(menu) {
  if (!bestByMenu.has(menu)) {
    let net = -Infinity, served = 0;
    for (const action of menu) {
      net = Math.max(net, action.net);
      served = Math.max(served, action.served);
    }
    bestByMenu.set(menu, {net, served});
  }
  return bestByMenu.get(menu);
}

// Couple the two placements to the SAME possible next board and repair status.
// These are public scenarios and posterior masses available to either dispatcher.
function inputs(frame, cost, parent, short, long) {
  const {obs} = frame, {incident, epoch} = obs, next = epoch + 1, later = Math.min(next + 1, 9);
  const repair = closureProbabilities(obs), projected = fleetWeekHubProjection(obs);
  const immediate = long.net - short.net, closedNext = repair[next];
  let loss = 0, win = 0, downside = 0, upside = 0, coverLost = 0, coverGained = 0;
  const conditionalNet = [0, 0];
  for (const board of fleetWeekBoardScenarios(next)) {
    const hubMass = .68 * projected[next][board.hub] + .21 * Number(obs.hub === board.hub) + .11 / 3;
    const boardMass = board.weight * hubMass;
    for (const closed of [0, 1]) {
      const state = closed ? {status:"closed", depot:incident.depot} : undefined;
      const value = positions => immediateValues(closureActions({positions, orders:board.orders, incident:state}));
      const s = value(short.positions), l = value(long.positions), delta = immediate + l.net - s.net;
      const mass = boardMass * (closed ? closedNext : 1 - closedNext);
      conditionalNet[closed] += boardMass * delta;
      loss += mass * Number(delta < 0);
      win += mass * Number(delta > 0);
      downside += mass * Math.max(0, -delta);
      upside += mass * Math.max(0, delta);
      coverLost += mass * Number(l.served < s.served);
      coverGained += mass * Number(l.served > s.served);
    }
  }
  const coverageChange = depot => Number(long.positions.includes(depot)) - Number(short.positions.includes(depot));
  const laterCoverage = projected[later].reduce((sum, probability, depot) => sum + probability * coverageChange(depot), 0);
  const time = (9 - epoch) / 9;
  return [1, parent.score, parent.lossProbability, parent.winProbability, parent.expectedDownside, parent.expectedUpside,
    parent.expectedService, cost.recallEstimate.score, cost.previous.winProbability, time,
    Math.max(0, epoch - incident.start), Number(incident.status === "warning"), Number(incident.update === "delayed"),
    closedNext, repair[later], immediate, long.served - short.served, loss, win, downside, upside,
    coverLost, coverGained, ...conditionalNet, laterCoverage, loss * (1 - time), coverageChange(incident.depot) * closedNext];
}

export function addGuardFromCost(frame, cost, shortAction, longAction, weights) {
  const parent = switchCostDecision(cost, weights.parent);
  return {...cost, parent, guardEligible:parent.added,
    guardX:parent.added ? inputs(frame, cost, parent, shortAction, longAction) : null};
}
export function addGuardProposal(frame, menu, weights, prepared) {
  const cost = switchCostProposal(frame, menu, weights, prepared);
  return addGuardFromCost(frame, cost, menu.find(a => a.id === cost.shortId),
    menu.find(a => a.id === cost.longId), weights);
}
export function guardRaw(x, model) {
  const z = x.map((v, j) => j === 0 ? 1 : (v - model.center[j]) / model.scale[j]);
  return guardHeads.map(h => model.heads[h].reduce((value, w, j) => value + w * z[j], 0));
}
export function guardEstimates(x, model, {flatGate = false} = {}) {
  const raw = flatGate ? null : guardRaw(x, model);
  const y = guardHeads.map((h, j) => {
    const c = model.calibration[h];
    return raw ? c.mean + c.slope * (raw[j] - c.predictedMean) : c.mean;
  });
  const clamp = v => Math.min(1, Math.max(0, v));
  const mass = Math.max(1, clamp(y[0]) + clamp(y[1]));
  return {loss:clamp(y[0]) / mass, win:clamp(y[1]) / mass, downside:Math.max(0, y[2]),
    upside:Math.max(0, y[3]), service:y[4]};
}
export function guardRisk(e) {
  return e.downside - e.upside - 12 * e.service + 12 * e.loss - 18 * e.win;
}
export function addGuardDecision(p, model, options) {
  const estimates = p.guardEligible ? guardEstimates(p.guardX, model, options) : null;
  const risk = estimates ? guardRisk(estimates) : null;
  const vetoed = p.guardEligible && model.settings.above !== null && risk > model.settings.above;
  return {...p.parent, parentId:p.parent.chosenId, guardEligible:p.guardEligible, guardRisk:risk,
    guardEstimates:estimates, guardVetoed:vetoed, chosenId:vetoed ? p.parent.shortId : p.parent.chosenId};
}
export function inspectAddGuard(obs, menu, model, weights, options) {
  return addGuardDecision(addGuardProposal(closureFrame(obs), menu, weights), model, options);
}
export function makeAddGuardPolicy(model, weights, options) {
  return (obs, menu) => inspectAddGuard(obs, menu, model, weights, options).chosenId;
}
