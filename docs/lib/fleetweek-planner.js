import { FLEET_PAIRS, FLEET_WEEK_EPOCHS, fleetPairIndex, fleetWeekActions, fleetWeekBoardScenarios } from "./fleetweek.js";

export function bestFleetAction(actions, continuation) {
  let best, bestValue = -Infinity;
  for (const action of actions) {
    const value = action.net + (continuation ? continuation[fleetPairIndex(action.positions)] : 0);
    if (value > bestValue || (value === bestValue &&
        (action.served > best.served || (action.served === best.served && action.emptyMiles < best.emptyMiles)))) {
      bestValue = value;
      best = action;
    }
  }
  if (!best) throw new RangeError("A fleet decision requires at least one legal action.");
  return best.id;
}

export function chooseFleetGreedy(observation, legalActions = fleetWeekActions(observation)) {
  return bestFleetAction(legalActions, null);
}

// For each observed board, the best immediate reward of ending in each pair. Costs and order
// conflicts come from the very same public menu that a visiting agent receives.
let rewardTables;
function getRewardTables() {
  if (rewardTables) return rewardTables;
  rewardTables = [0, 1].map(phase => {
    const boards = fleetWeekBoardScenarios(phase);
    return boards.map(board => {
      const rewards = new Float64Array(36).fill(-Infinity);
      FLEET_PAIRS.forEach((positions, from) => {
        for (const action of fleetWeekActions({ positions, orders: board.orders })) {
          const index = 6 * from + fleetPairIndex(action.positions);
          rewards[index] = Math.max(rewards[index], action.net);
        }
      });
      return { ...board, rewards };
    });
  });
  return rewardTables;
}

const stay = 0.65;
function propagate(vector) {
  const change = (1 - stay) / 2;
  return [0, 1, 2].map(d => stay * vector[d] + change * (vector[(d + 1) % 3] + vector[(d + 2) % 3]));
}
function normalize(vector) {
  const denominator = vector[0] + vector[1] + vector[2];
  return vector.map(v => v / denominator);
}

// A planning model of the unobserved demand center, with a public persistence prior.
// Filter past realized hubs and smooth with the whole bulletin issued on Monday.
// It does not know the weekly regime, scenario seed, or any future orders.
export function fleetWeekHubProjection(observation) {
  const { epoch, history, forecast, hub } = observation;
  const evidence = forecast.map((probabilities, t) => {
    if (t > epoch) return probabilities;
    const actual = t === epoch ? hub : history[t].hub;
    const prior = t === 0 ? null : history[t - 1].hub;
    return probabilities.map((p, d) => p * (0.11 / 3 + (d === actual ? (t === 0 ? 0.89 : 0.68) : 0)
      + (prior === actual ? 0.21 : 0)));
  });
  const forward = [];
  let f = [1 / 3, 1 / 3, 1 / 3];
  for (const row of evidence) {
    f = normalize(propagate(f).map((p, d) => p * row[d]));
    forward.push(f);
  }
  let back = [1, 1, 1];
  const posterior = new Array(FLEET_WEEK_EPOCHS);
  for (let t = FLEET_WEEK_EPOCHS - 1; t >= 0; t--) {
    posterior[t] = normalize(forward[t].map((p, d) => p * back[d]));
    back = normalize(propagate(back.map((p, d) => p * evidence[t][d])));
  }
  return posterior;
}

export function fleetPlannerContinuation(observation) {
  const { epoch, hub } = observation;
  if (epoch === FLEET_WEEK_EPOCHS - 1) return new Float64Array(6);
  return fleetContinuationFromProjection(epoch, hub, fleetWeekHubProjection(observation));
}

// Integrate the existing public freight-board distribution under a supplied demand belief.
export function fleetContinuationFromProjection(epoch, hub, posterior) {
  const tables = getRewardTables();
  let next = new Float64Array(18);
  for (let t = FLEET_WEEK_EPOCHS - 1; t > epoch; t--) {
    // Condition the choice on the newly signed board before averaging the best feasible
    // return. The continuation value remembers the realized hub and both truck locations.
    const byHub = new Float64Array(18);
    for (const { hub: realized, weight, rewards } of tables[t % 2]) {
      for (let from = 0; from < 6; from++) {
        let best = -Infinity;
        for (let to = 0; to < 6; to++) {
          const value = rewards[6 * from + to] + next[6 * realized + to];
          if (value > best) best = value;
        }
        byHub[6 * realized + from] += weight * best;
      }
    }
    const earlier = new Float64Array(18);
    for (let from = 0; from < 6; from++) {
      let base = 0;
      for (let h = 0; h < 3; h++) base += (0.68 * posterior[t][h] + 0.11 / 3) * byHub[6 * h + from];
      for (let prior = 0; prior < 3; prior++) earlier[6 * prior + from] = base + 0.21 * byHub[6 * prior + from];
    }
    next = earlier;
  }
  return next.subarray(6 * hub, 6 * hub + 6);
}

export function chooseFleetPlanner(observation, legalActions = fleetWeekActions(observation)) {
  if (observation.epoch === FLEET_WEEK_EPOCHS - 1) return chooseFleetGreedy(observation, legalActions);
  return bestFleetAction(legalActions, fleetPlannerContinuation(observation));
}
