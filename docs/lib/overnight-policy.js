import { fleetPairIndex } from "./fleetweek.js";
import { fleetFeatures } from "./fleetweek-policy.js";
import { bestFleetAction, chooseFleetPlanner, fleetPlannerContinuation } from "./fleetweek-planner.js";

export function isOvernight(epoch) {
  return epoch === 1 || epoch === 3 || epoch === 5 || epoch === 7;
}

function isIdle(code) {
  return code === "W" || code.startsWith("E");
}

// The same truck still hauls each signed load. Only unladen assignments can differ.
export function sameFreight(a, b) {
  return a.moves.every((code,i) => code === b.moves[i] || (isIdle(code) && isIdle(b.moves[i])));
}

export function centerFleetValues(vector) {
  const mean = vector.reduce((sum,x) => sum + x, 0) / vector.length;
  return Array.from(vector, x => x - mean);
}

export function overnightFeatures(obs, plannerValues) {
  const features = fleetFeatures(obs);
  const leads = obs.forecast.map(row => row.indexOf(Math.max(...row)));
  // The second model of the bulletin treats each lead as equally confident.
  // The fit can learn which interpretation predicts the value of each placement.
  const fixed = leads.map(lead => [0,1,2].map(d => d === lead ? 0.72 : 0.14));
  const alternative = fleetPlannerContinuation({...obs, forecast:fixed});
  const raw = centerFleetValues(plannerValues);
  const normalized = centerFleetValues(alternative);
  for (let p=0; p<6; p++) features.push(raw[p]/50, (normalized[p]-raw[p])/10);

  const t=obs.epoch;
  const prev = obs.history.at(-1).hub;
  const at = offset => leads[Math.max(0, Math.min(9, t + offset))];
  for (const d of [0,1,2]) {
    const named = Number(at(1) === d);
    features.push(Number(at(-1) === d), Number(at(0) === d), named, Number(at(2) === d),
      named * Number(at(0) === at(2)), named * Number(at(1) === at(3)),
      named * Number(obs.hub === at(0)), named * Number(obs.hub === prev),
      Number(obs.hub === d && obs.hub === at(2)), Number(at(0) === d && at(0) === at(2)));
  }
  return features;
}

function dot(coefficients, features) {
  let sum = 0;
  for (let i=0; i<features.length; i++) sum += coefficients[i] * features[i];
  return sum;
}

export function overnightHeads(obs, plannerValues, checkpoint) {
  const features = overnightFeatures(obs, plannerValues);
  const heads = checkpoint.nights[(obs.epoch - 1) / 2];
  return {residual:heads.net.map(row=>dot(row,features)), service:heads.service.map(row=>dot(row,features))};
}

export function rankOvernight(menu, reference, plannerValues, heads, settings) {
  const value = action => {
    const pair = fleetPairIndex(action.positions);
    return action.net + plannerValues[pair] + settings.blend * heads.residual[pair] +
      settings.serviceCredit * heads.service[pair];
  };
  const referenceValue = value(reference);
  let choice = reference, best = referenceValue;
  for (const action of menu) {
    if (!sameFreight(action,reference)) continue;
    const score = value(action);
    if (score > best) {
      choice = action;
      best = score;
    }
  }
  return best - referenceValue > settings.minimumGain ? choice.id : reference.id;
}

export function chooseOvernight(obs, menu, checkpoint) {
  if (!isOvernight(obs.epoch)) return chooseFleetPlanner(obs,menu);
  const base = fleetPlannerContinuation(obs);
  const refId = bestFleetAction(menu,base);
  const ref = menu.find(a=>a.id === refId);
  if (!ref.moves.some(isIdle)) return refId;
  return rankOvernight(menu,ref,base,overnightHeads(obs,base,checkpoint),checkpoint.settings);
}

export function makeOvernightPolicy(checkpoint) {
  return (observation, legalActions) => chooseOvernight(observation, legalActions, checkpoint);
}
