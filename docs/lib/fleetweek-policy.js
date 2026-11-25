import { bestFleetAction } from "./fleetweek-planner.js";
export { FLEET_PAIRS, fleetPairIndex } from "./fleetweek.js";

// The forecast is published at the week's opening. Hub observations end at
// the current board. No seed, family, unseen order or next realized hub is used.
export function fleetFeatures(o) {
  const t = o.epoch, current = o.hub;
  const next = o.forecast[Math.min(t + 1, 9)];
  const later = o.forecast[Math.min(t + 2, 9)];
  const previous = o.history.at(-1)?.hub ?? current;
  const before = o.history.at(-2)?.hub ?? previous;
  const seen = o.history.map(frame => frame.hub).concat(current);
  const weights = [0, 0, 0], hits = [0, 0, 0];
  let mass = 0;
  for (let i = 0; i < seen.length; i++) {
    const weight = 0.7 ** (seen.length - 1 - i);
    weights[seen[i]] += weight;
    mass += weight;
    // Diagnose demand arriving ahead of, with or behind the public timetable.
    for (let offset = -1; offset <= 1; offset++) {
      const k = Math.min(9, Math.max(0, i + offset));
      hits[offset + 1] += weight * o.forecast[k][seen[i]];
    }
  }
  const leaders = o.forecast.map(row => row.indexOf(Math.max(...row)));
  const nextEpoch = Math.min(t + 1, 9);
  const neighborhood = [0, 0, 0];
  let forecastMass = 0;
  for (let epoch = 0; epoch < leaders.length; epoch++) {
    const weight = 0.45 ** Math.abs(epoch - nextEpoch);
    neighborhood[leaders[epoch]] += weight;
    forecastMass += weight;
  }
  const f = [1];
  // The omitted third coordinate of a distribution follows from its unit sum.
  for (let depot = 0; depot < 2; depot++) {
    f.push(Number(current === depot), Number(previous === depot), Number(before === depot),
      weights[depot] / mass, o.forecast[t][depot], next[depot], later[depot]);
  }
  const ahead = (hits[2] - hits[1]) / mass;
  const behind = (hits[0] - hits[1]) / mass;
  const surprise = 1 - o.forecast[t][current];
  const stayed = Number(current === previous);
  f.push(ahead, behind, surprise, stayed);
  for (let depot = 0; depot < 2; depot++) {
    const here = Number(current === depot);
    const called = Number(leaders[nextEpoch] === depot);
    const following = Number(leaders[Math.min(9, t + 2)] === depot);
    const priorCall = Number(leaders[t] === depot);
    f.push(called, following, priorCall, neighborhood[depot] / forecastMass,
      called * here, called * following, called * priorCall, here * following);
    f.push(here * stayed, here * surprise, here * ahead, here * behind,
      next[depot] * surprise, next[depot] * stayed,
      (later[depot] - next[depot]) * ahead, (o.forecast[t][depot] - next[depot]) * behind);
    for (let hub = 0; hub < 2; hub++) {
      f.push(next[depot] * Number(current === hub), here * Number(previous === hub));
    }
  }
  return f;
}

export function fleetContinuation(weights, features) {
  if (!weights) return [0, 0, 0, 0, 0, 0];
  return weights.map(row => {
    let sum = 0;
    for (let i = 0; i < features.length; i++) sum += row[i] * features[i];
    return sum;
  });
}

export function chooseFleetRL(observation, legalActions, checkpoint) {
  const weights = checkpoint.weights[observation.epoch];
  const future = weights ? fleetContinuation(weights, fleetFeatures(observation)) : [0,0,0,0,0,0];
  return bestFleetAction(legalActions, future);
}

export function makeFleetPolicy(checkpoint) {
  return (observation, legalActions) => chooseFleetRL(observation, legalActions, checkpoint);
}
