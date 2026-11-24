// A linear score for each candidate tool call. Parameters are learned on environment rollouts.
import {availableActions, dispatcher} from './world.js';

const TOOLS = [
  'query_inventory', 'check_supplier_status', 'check_transport_capacity',
  'purchase_inventory', 'book_shipment',
  'advance_time',
];

export const FEATURE_NAMES = [
  ...TOOLS,
  'booking quantity', 'fraction of open order', 'booking completes open order', 'unit cost',
  'journey duration', 'deadline slack', 'arrival past deadline', 'share of source stock',
  'reported inventory too low', 'reported capacity too low', 'booking fits remaining budget',
  'cheapest viable source', 'sole viable source', 'other orders relying on this source',
  'source has stale inventory', 'route has stale capacity',
  'route has announced disruption', 'purchase quantity', 'purchase covers shortage',
  'purchase arrives before earliest open deadline', 'supplier status age',
  'inventory query age', 'capacity query age', 'stock below open demand',
  'wait with shipments in flight', 'wait with all demand covered', 'wait without viable route',
  'repeated unsuccessful action',
];
const index = Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, i]));
const clip = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function blankCheckpoint() {
  return {format: 1, algorithm: 'linear-softmax-reinforce', weights: FEATURE_NAMES.map(() => 0)};
}

function context(obs) {
  const orders = new Map(obs.orders.map(order => [order.id, order]));
  const warehouses = new Map(obs.warehouses.map(warehouse => [warehouse.id, warehouse]));
  const routes = new Map(obs.routes.map(route => [route.id, route]));
  const suppliers = new Map(obs.suppliers.map(supplier => [supplier.id, supplier]));
  const usable = new Map();
  const sourceDependents = new Map();
  let earliest = Infinity;
  let totalOpen = 0;
  let inFlight = 0;
  for (const order of obs.orders) {
    const open = Math.max(0, order.demand - order.delivered - order.inTransit);
    inFlight += order.inTransit;
    totalOpen += open;
    if (!open) continue;
    earliest = Math.min(earliest, order.deadline);
    const viable = obs.routes.filter(route =>
      route.customer === order.customer && route.open && obs.tick + route.travel <= order.deadline &&
      route.capacity > 0 && warehouses.get(route.source)?.reportedStock > 0 &&
      route.cost <= obs.budget
    );
    usable.set(order.id, viable);
    if (viable.length === 1) {
      const source = viable[0].source;
      sourceDependents.set(source, (sourceDependents.get(source) || 0) + 1);
    }
  }
  return {orders, warehouses, routes, suppliers, usable, sourceDependents, earliest, totalOpen, inFlight,
    totalStock: obs.warehouses.reduce((sum, warehouse) => sum + warehouse.reportedStock, 0),
    hasViable: [...usable.values()].some(viable => viable.length > 0)};
}

// Age estimates, reservations and route fitness use only the observation available to the operator.
function features(obs, ctx, action) {
  const f = new Float64Array(FEATURE_NAMES.length);
  const put = (key, value) => {f[index[key]] = Number(value);};
  if (index[action.tool] !== undefined) put(action.tool, 1);
  const route = ctx.routes.get(action.route);
  const order = ctx.orders.get(action.order);
  const warehouse = ctx.warehouses.get(action.warehouse ?? route?.source);
  const supplier = ctx.suppliers.get(action.supplier);
  const open = order ? Math.max(0, order.demand - order.delivered - order.inTransit) : 0;
  const quantity = action.quantity ?? 0;
  const age = resource => clip((obs.tick - (resource?.observedAt ?? -1)) / 3);

  if (action.tool === 'book_shipment' && route && order && warehouse) {
    const slack = order.deadline - obs.tick - route.travel;
    const viable = ctx.usable.get(order.id) ?? [];
    put('booking quantity', clip(quantity / 12));
    put('fraction of open order', clip(quantity / Math.max(open, 1)));
    put('booking completes open order', quantity >= open && open > 0);
    put('unit cost', clip(route.cost / 5));
    put('journey duration', clip(route.travel / 5));
    put('deadline slack', clip(slack / 6, -1, 1));
    put('arrival past deadline', slack < 0);
    put('share of source stock', clip(quantity / Math.max(1, warehouse.reportedStock)));
    put('reported inventory too low', quantity > warehouse.reportedStock);
    put('reported capacity too low', quantity > route.capacity);
    put('booking fits remaining budget', quantity * route.cost <= obs.budget);
    put('cheapest viable source', viable.some(r => r.id === route.id) && viable.every(r => r.cost >= route.cost));
    put('sole viable source', viable.length === 1 && viable[0].id === route.id);
    const otherDependents = (ctx.sourceDependents.get(route.source) || 0) -
      Number(viable.length === 1 && viable[0].id === route.id);
    put('other orders relying on this source', clip(otherDependents / 3));
    put('source has stale inventory', age(warehouse));
    put('route has stale capacity', age(route));
    put('route has announced disruption', obs.events.some(event => event.route === route.id && ['closure','capacity-cut'].includes(event.type)));
  } else if (action.tool === 'purchase_inventory' && supplier) {
    put('purchase quantity', clip(quantity / 12));
    put('purchase covers shortage', clip((ctx.totalOpen - ctx.totalStock) / Math.max(1, quantity)));
    put('purchase arrives before earliest open deadline', obs.tick + supplier.eta < ctx.earliest);
    put('supplier status age', age(supplier));
  } else if (action.tool === 'query_inventory') {
    put('inventory query age', age(warehouse));
    put('stock below open demand', ctx.totalStock < ctx.totalOpen);
  } else if (action.tool === 'check_transport_capacity') {
    put('capacity query age', age(route));
  } else if (action.tool === 'advance_time') {
    put('wait with shipments in flight', clip(ctx.inFlight / 16));
    put('wait with all demand covered', ctx.totalOpen === 0);
    put('wait without viable route', !ctx.hasViable);
  } else if (action.tool === 'check_supplier_status') {
    put('supplier status age', age(supplier));
  }
  if (obs.lastResult?.ok === false) {
    const failed = obs.lastResult.action;
    put('repeated unsuccessful action', failed && Object.keys(action).every(k => action[k] === failed[k]) ? 1 : 0);
  }
  return f;
}

function makeChoiceSet(obs, weights) {
  const actions = availableActions(obs);
  if (!actions.length) throw new Error('An active episode needs at least one available action');
  const ctx = context(obs);
  const vectors = actions.map(action => features(obs, ctx, action));
  const scores = vectors.map(vector => {
    let score = 0;
    for (let i = 0; i < vector.length; i++) score += vector[i] * weights[i];
    return score;
  });
  return {actions, vectors, scores};
}

function tieIndex(obs, count) {
  // Resolve ties reproducibly from public observations, independently of enumeration order trends.
  let hash = Math.imul(obs.decisions + 1, 0x1b873593) ^ Math.imul(obs.tick + 7, 0x85ebca6b);
  for (const order of obs.orders) hash = Math.imul(hash ^ (order.demand + order.deadline), 0x5bd1e995);
  hash ^= hash >>> 16;
  return (hash >>> 0) % count;
}

export function chooseAction(obs, checkpoint) {
  if (checkpoint === 'dispatcher') return dispatcher(obs);
  const weights = checkpoint === 'untrained' ? blankCheckpoint().weights : checkpoint?.weights;
  if (!Array.isArray(weights) || weights.length !== FEATURE_NAMES.length) throw new Error('Incompatible DISPATCH checkpoint');
  const {actions, scores} = makeChoiceSet(obs, weights);
  const largest = Math.max(...scores);
  const best = [];
  scores.forEach((v, i) => {if (v === largest) best.push(i);});
  return actions[best[tieIndex(obs, best.length)]];
}

// Sample from the softmax and compute the analytical gradient of log pi(action | observation).
export function sampleAction(obs, weights, random) {
  const {actions, vectors, scores} = makeChoiceSet(obs, weights);
  const largest = Math.max(...scores);
  const mass = scores.map(value => Math.exp(value - largest));
  const total = mass.reduce((sum, value) => sum + value, 0);
  let target = random() * total;
  let selected = 0;
  while (selected < mass.length - 1 && (target -= mass[selected]) >= 0) selected++;
  const grad = vectors[selected].slice();
  for (let a = 0; a < vectors.length; a++) {
    const probability = mass[a] / total;
    for (let i = 0; i < grad.length; i++) grad[i] -= probability * vectors[a][i];
  }
  return {action: actions[selected], grad};
}
