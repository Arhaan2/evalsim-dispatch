import {FLEET_MISS_PENALTY, fleetPairIndex} from "./fleetweek.js";
import {fleetWeekHubProjection} from "./fleetweek-planner.js";
import {closureActions, closureProbabilities} from "./closure-world.js";
import {closureFrame} from "./closure-planner.js";
import {choosePosition, predictMenus, prepositionProposal} from "./preposition-policy.js";
import {treeValue} from "./longmove-policy.js";

export const guardOutcomes = ["friday", "service", "net"];

const pairIndicators = ["closed", "next-signed-origin", "other-open", "current-hub"];
const boardNames = ["next", "friday-am", "friday-pm"];
export const guardFeatureNames = [
  "warning-epoch", "closed-depot", "current-hub", "current-contract-origin", "current-contract-destination",
  "challenger-is-parent", "challenger-is-211", "default-is-parent", "default-is-211",
  "default-net", "immediate-net-difference", "default-served", "immediate-served-difference",
  "empty-cost-difference", "loaded-cost-difference", "default-spread", "spread-difference",
  "fit-101-net-difference", "fit-101-service-difference", "fit-211-net-difference", "fit-211-service-difference",
  "planner-continuation-difference", "friday-am-repair-probability", "friday-pm-repair-probability",
  ...pairIndicators.flatMap(name => [name + "-default-trucks", name + "-trucks-difference"]),
  ...boardNames.flatMap(name => [name + "-forecast-closed", name + "-forecast-current-hub",
    name + "-default-coverage", name + "-coverage-difference", name + "-default-service", name + "-service-difference"]),
];

// Exposure if the warning placement persisted until this board. The forecast
// and public repair prior are all that is known about either Friday load.
function boardExposure(positions, epoch, distribution, depot, closedChance) {
  let coverage = 0, service = 0;
  const direction = epoch % 2 === 0 ? 1 : -1;
  for (let hub = 0; hub < 3; hub++) {
    if (positions.includes(hub)) coverage += distribution[hub];
    // Public board layout frequencies put 80% of contracts at the hub and
    // 20% at its far depot. Every contract travels one depot in phase direction.
    for (const [origin, chance] of [[hub, .8], [(hub - direction + 3) % 3, .2]]) {
      if (!positions.includes(origin)) continue;
      const destination = (origin + direction + 3) % 3;
      const open = origin === depot || destination === depot ? 1 - closedChance : 1;
      service += distribution[hub] * chance * open;
    }
  }
  return [coverage, service];
}

function pairFeatures(obs, base, incumbent, alternate, ids, predictions, projection, closure) {
  const closed = obs.incident.depot, next = obs.epoch + 1;
  const signedOrigin = (closed + (next % 2 === 0 ? 1 : 2)) % 3;
  const contract = obs.orders.find(order => order.kind === "contract");
  const a = incumbent.positions, b = alternate.positions;
  const spread = pair => Number(pair[0] !== pair[1]);
  const count = (pair, depot) => Number(pair[0] === depot) + Number(pair[1] === depot);
  const x = [obs.epoch, closed, obs.hub, contract.origin, contract.destination,
    Number(alternate.id === ids.parentId), Number(alternate.id === ids.fit211Id),
    Number(incumbent.id === ids.parentId), Number(incumbent.id === ids.fit211Id),
    incumbent.net, alternate.net - incumbent.net, incumbent.served, alternate.served - incumbent.served,
    alternate.emptyCost - incumbent.emptyCost, alternate.loadedCost - incumbent.loadedCost, spread(a), spread(b) - spread(a)];
  for (const scores of predictions) {
    const baseline = scores.find(s => s.id === incumbent.id), challenger = scores.find(s => s.id === alternate.id);
    x.push(challenger.net - baseline.net, challenger.service - baseline.service);
  }
  x.push(base[fleetPairIndex(b)] - base[fleetPairIndex(a)], closure[8], closure[9]);
  for (const h of [closed, signedOrigin, 3 - signedOrigin - closed, obs.hub]) {
    x.push(count(a, h), count(b, h) - count(a, h));
  }
  for (const t of [next, 8, 9]) {
    const distribution = projection[t];
    const [coverA, serveA] = boardExposure(a, t, distribution, closed, closure[t]);
    const [coverB, serveB] = boardExposure(b, t, distribution, closed, closure[t]);
    x.push(distribution[closed], distribution[obs.hub], coverA, coverB - coverA, serveA, serveB - serveA);
  }
  return x;
}

export function fridayGuardProposal(frame, menu, weights) {
  const p = prepositionProposal(frame, menu, weights);
  const ids = {warning:p.warning, parentId:p.parentId, plannerId:p.plannerId, shortId:p.shortId,
    constantId:p.constantId, defaultId:p.parentId, fit101Id:p.parentId, fit211Id:p.parentId};
  if (!p.warning) return {...ids, choices:[]};
  const models = [weights.preposition101, weights.preposition211];
  const predictions = models.map(model => predictMenus(p, model));
  [ids.fit101Id, ids.fit211Id] = models.map((m, i) => choosePosition(predictions[i], p.parentId, m.settings).chosenId);
  ids.defaultId = ids.fit101Id;
  const alternatives = [...new Set([ids.fit211Id, ids.parentId])].filter(id => id !== ids.defaultId);
  if (!alternatives.length) return {...ids, choices:[]};
  const base = menu.find(a => a.id === ids.defaultId), projection = fleetWeekHubProjection(frame.obs);
  let previous = [0, 1, 2].map(h => Number(h === frame.obs.hub));
  for (let t = frame.obs.epoch + 1; t < projection.length; t++) {
    projection[t] = projection[t].map((mass, h) => .68 * mass + .21 * previous[h] + .11 / 3);
    previous = projection[t];
  }
  const closure = closureProbabilities(frame.obs);
  return {...ids, choices:alternatives.map(id => ({id, x:pairFeatures(frame.obs, frame.base, base,
    menu.find(a => a.id === id), ids, predictions, projection, closure)}))};
}

export function guardEstimates(choices, heads) {
  return choices.map(({id, x}) => {
    const estimate = {id};
    for (const name of guardOutcomes) {
      const head = heads[name];
      let prediction = head.bias;
      for (const tree of head.trees) prediction += head.rate * treeValue(tree, x);
      estimate[name] = prediction;
    }
    return estimate;
  });
}

export function chooseFridayGuard(defaultId, estimates, settings) {
  let best = defaultId, bestValue = settings.hurdle;
  if (!settings.alwaysDefault) for (const e of estimates) {
    const score = e.friday + settings.serviceWeight * e.service + settings.netWeight * e.net / FLEET_MISS_PENALTY;
    if (score > bestValue) {best = e.id; bestValue = score;}
  }
  return best;
}
export function decideFridayGuard(p, model) {
  return p.choices.length ? chooseFridayGuard(p.defaultId, guardEstimates(p.choices, model.heads), model.settings) : p.defaultId;
}
export function makeFridayGuardPolicy(model, weights) {
  const act = (obs, menu = closureActions(obs)) => decideFridayGuard(fridayGuardProposal(closureFrame(obs), menu, weights), model);
  act.act = act;
  return act;
}
