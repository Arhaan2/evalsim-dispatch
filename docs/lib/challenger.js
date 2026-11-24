/** A saved categorical challenger policy. Its action is a scenario family and opening demand band. */
import {createWorld, feasiblePlan, makeScenario, step, verify} from './world.js';

export const FAMILIES = ['normal','route-closure','supplier-delay','capacity-cut','demand-surge'];
const FAMILY_LABELS = ['Clear lanes','Route closure','Supplier delay','Capacity cut','Demand surge'];
export const CELLS = FAMILIES.flatMap((kind, familyIndex) =>
  ['ordinary','high'].map(band => ({
    kind, band, id: kind + '/' + band, label: FAMILY_LABELS[familyIndex] + ' · ' + band + ' opening demand',
  })));
export const EXPLORATION = 0.2;

export function demandBand(scenario) {
  const openingDemand = scenario.orders.reduce((sum, order) => sum + order.demand, 0);
  return openingDemand > 28 ? 'high' : 'ordinary';
}

export function softmax(logits) {
  if (!Array.isArray(logits) || logits.length !== CELLS.length || !logits.every(Number.isFinite)) {
    throw new Error('Invalid challenger policy');
  }
  const largest = Math.max(...logits);
  const weights = logits.map(value => Math.exp(value - largest));
  const sum = weights.reduce((total, value) => total + value, 0);
  return weights.map(value => value / sum);
}

export function cellProbabilities(logits) {
  return softmax(logits).map(probability => EXPLORATION / CELLS.length + (1 - EXPLORATION) * probability);
}

export function sampleCell(probabilities, random) {
  let draw = random();
  for (let i = 0; i < probabilities.length - 1; i++) {
    if ((draw -= probabilities[i]) < 0) return i;
  }
  return probabilities.length - 1;
}

export function checkFeasible(scenario) {
  const world = createWorld(scenario);
  while (!world.done) step(world, feasiblePlan(world));
  const verdict = verify(world);
  return {success: verdict.success, toolCalls: verdict.toolCalls};
}

function randomStream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    // Fold sequential visitor seeds into independent sampling decisions.
    let x = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
}

export function drawChallenge(checkpoint, viewerSeed) {
  if (!Number.isSafeInteger(viewerSeed) || viewerSeed < 0 || viewerSeed > 0xffffffff) {
    throw new RangeError('Viewer seed must be an unsigned 32-bit integer');
  }
  if (checkpoint?.format !== 'dispatch-challenger-v1') throw new Error('Unknown challenger format');
  const random = randomStream(viewerSeed);
  const probabilities = cellProbabilities(checkpoint.logits);
  const index = sampleCell(probabilities, random);
  const cell = CELLS[index];
  for (let i = 0; i < 256; i++) {
    const seed = Math.floor(random() * 4294967296);
    const scenario = makeScenario(seed, cell.kind);
    if (demandBand(scenario) === cell.band && checkFeasible(scenario).success) {
      return {kind: cell.kind, seed, cell: cell.id, label: cell.label, probability: probabilities[index]};
    }
  }
  throw new Error('Could not construct a feasible challenge in the requested demand band');
}
