// EvalSim DISPATCH · five-day fleet positioning. One epoch is one half-day.
import { OVERNIGHT_PATTERNS } from "./overnight-markets.js";
import { OVERRIDE_PATTERNS } from "./override-markets.js";
import { UNCERTAINTY_PATTERNS } from "./uncertainty-markets.js";
import { LOSS_PATTERNS } from "./loss-markets.js";
import { CLOSURE_PATTERNS } from "./closure-markets.js";
import { LONGREPAIR_PATTERNS } from "./longrepair-markets.js";
import { SHORTDEFAULT_PATTERNS } from "./shortdefault-markets.js";
export const FLEET_DEPOTS = Object.freeze(["Harbor", "Inland", "Junction"]);
export const FLEET_WEEK_EPOCHS = 10;
export const FLEET_MISS_PENALTY = 34;
// Value functions may disregard truck identity; the dispatcher still names one move per truck.
export const FLEET_PAIRS = Object.freeze([[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]].map(pair => Object.freeze(pair)));
const pairLookup = [[0, 1, 2], [1, 3, 4], [2, 4, 5]];
export function fleetPairIndex(positions) { return pairLookup[positions[0]][positions[1]]; }
const distances = [[0, 20, 32], [20, 0, 26], [32, 26, 0]];
const patterns = Object.freeze({
  "steady-market": "0000000000", eastbound: "0011220011", "late-transfer": "0000011111",
  alternating: "0101010101", "double-shift": "0001112222", "midweek-return": "0001111000",
  "twin-peaks": "0011001100", "slow-handoff": "0000112222", "short-diversion": "0011100222",
  "friday-switch": "0011100002", "split-week": "0001102221", "midweek-pivot": "0011122200",
  "double-return": "0011002200",
});
export const FLEET_FAMILIES = Object.freeze({
  train: Object.freeze(["steady-market", "eastbound", "late-transfer", "alternating",
    "double-shift", "midweek-return", "twin-peaks"]),
  validation: Object.freeze(["slow-handoff", "short-diversion"]),
  test: Object.freeze(["friday-switch", "split-week", "midweek-pivot", "double-return"]),
});
export const FLEET_PATTERNS = patterns;
const allPatterns = Object.freeze({ ...patterns, ...OVERNIGHT_PATTERNS, ...OVERRIDE_PATTERNS, ...UNCERTAINTY_PATTERNS, ...LOSS_PATTERNS, ...CLOSURE_PATTERNS, ...LONGREPAIR_PATTERNS, ...SHORTDEFAULT_PATTERNS });

function randomStream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shifted(origin, offset) {
  return (origin + offset + 3) % 3;
}

function makeOrder(id, origin, destination, revenue) {
  return Object.freeze({
    id, kind: id === "C" ? "contract" : "spot", origin, destination, revenue,
    loadedCost: Math.round(distances[origin][destination] * 0.45),
  });
}

const layoutWeights = [0.5, 0.3, 0.2];
const fareWeights = [0.65, 0.35];

function makeBoards(phase) {
  const boards = [];
  const direction = phase === 0 ? 1 : -1;
  for (let hub = 0; hub < 3; hub++) {
    const near = shifted(hub, direction);
    const far = shifted(hub, -direction);
    for (let layout = 0; layout < 3; layout++) {
      const contractOrigin = layout === 2 ? far : hub;
      const firstOrigin = layout === 1 ? near : hub;
      const secondOrigin = layout === 0 ? far : near;
      for (let premium = 0; premium < 2; premium++) {
        const orders = Object.freeze([
          makeOrder("C", contractOrigin, shifted(contractOrigin, direction), 38 + 2 * phase),
          makeOrder("S0", firstOrigin, shifted(firstOrigin, -direction), 38 + 21 * premium + 3 * phase),
          makeOrder("S1", secondOrigin, shifted(secondOrigin, direction), 37 + 10 * (1 - premium)),
        ]);
        boards.push(Object.freeze({ hub, orders, weight: layoutWeights[layout] * fareWeights[premium] }));
      }
    }
  }
  return Object.freeze(boards);
}
const markets = [makeBoards(0), makeBoards(1)];

// Complete conditional board distribution given a demand hub. No weekly tape is consulted.
export function fleetWeekBoardScenarios(epoch) {
  if (!Number.isInteger(epoch) || epoch < 0 || epoch >= FLEET_WEEK_EPOCHS) throw new RangeError("Unknown fleet epoch.");
  return markets[epoch % 2];
}

function options(origin, orders) {
  const moves = [{ code: "W", destination: origin, gross: 0, loadedCost: 0, emptyCost: 0, miles: 0 }];
  for (let depot = 0; depot < 3; depot++) if (depot !== origin) {
    const miles = distances[origin][depot];
    moves.push({ code: "E" + depot, destination: depot, gross: 0, loadedCost: 0, emptyCost: Math.round(miles * 0.6), miles });
  }
  for (const order of orders) if (order.origin === origin) {
    moves.push({ code: order.id, destination: order.destination, gross: order.revenue,
      loadedCost: order.loadedCost, emptyCost: 0, miles: 0 });
  }
  return moves;
}

function jointMenu(positions, orders) {
  const actions = [];
  const first = options(positions[0], orders);
  const second = options(positions[1], orders);
  for (const a of first) for (const b of second) {
    if (a.code === b.code && (a.code === "C" || a.code.startsWith("S"))) continue;
    const served = Number(a.code === "C" || b.code === "C");
    const penalty = served ? 0 : FLEET_MISS_PENALTY;
    const gross = a.gross + b.gross, emptyCost = a.emptyCost + b.emptyCost, loadedCost = a.loadedCost + b.loadedCost;
    actions.push(Object.freeze({
      id: a.code + "|" + b.code, moves: Object.freeze([a.code, b.code]),
      positions: Object.freeze([a.destination, b.destination]),
      net: gross - loadedCost - emptyCost - penalty, gross, loadedCost, emptyCost, penalty,
      served, emptyMiles: a.miles + b.miles,
    }));
  }
  return Object.freeze(actions);
}

// Boards and truck-indexed menus recur across weeks. Bound this cache to the 36 immutable simulator boards.
const menus = new WeakMap();
for (const boards of markets) for (const board of boards) menus.set(board.orders, new Map());
export function fleetWeekActions(observation) {
  if (!observation) return Object.freeze([]);
  const { positions, orders } = observation;
  if (!Array.isArray(positions) || positions.length !== 2 ||
      !positions.every(p => Number.isInteger(p) && p >= 0 && p < 3)) throw new RangeError("Invalid fleet positions.");
  const cache = menus.get(orders);
  if (!cache) return jointMenu(positions, orders);
  const key = 3 * positions[0] + positions[1];
  if (!cache.has(key)) cache.set(key, jointMenu(positions, orders));
  return cache.get(key);
}

const forecasts = Array.from({ length: 3 }, (_, main) => [1, 2].map(offset => [false, true].map(strong => {
  const secondary = shifted(main, offset);
  return Object.freeze([0, 1, 2].map(hub => hub === main ? (strong ? 0.72 : 0.56) :
    hub === secondary ? (strong ? 0.18 : 0.27) : (strong ? 0.10 : 0.17)));
})));

function makeTape(seed, family) {
  const random = randomStream(seed);
  const rotation = Math.floor(random() * 3);
  const handedness = random() < 0.5 ? 1 : -1;
  const hubs = Array.from(allPatterns[family], symbol => shifted(rotation, handedness * Number(symbol)));
  // A Monday bulletin predicts each half-day. The issuing desk may lead, lag, or call the wrong hub.
  const forecast = Object.freeze(hubs.map((hub, i) => {
    const error = random();
    let predicted = hub;
    if (error < 0.14) predicted = hubs[Math.max(0, i - 1)];
    else if (error < 0.28) predicted = hubs[Math.min(9, i + 1)];
    else if (error < 0.44) predicted = shifted(hub, random() < 0.5 ? 1 : -1);
    return forecasts[predicted][Number(random() < 0.5)][Number(random() < 0.5)];
  }));
  let previous = hubs[0];
  const boards = hubs.map((hub, i) => {
    const realization = random();
    const realized = realization < 0.68 ? hub : realization < 0.89 ? previous : Math.floor(random() * 3);
    previous = realized;
    const layoutDraw = random();
    const layout = layoutDraw < 0.5 ? 0 : layoutDraw < 0.8 ? 1 : 2;
    const premium = Number(random() >= 0.65);
    return markets[i % 2][6 * realized + 2 * layout + premium];
  });
  return { forecast, boards };
}

const sumFields = Object.freeze(["net", "gross", "loadedCost", "emptyCost", "penalty", "served", "emptyMiles"]);
export function createFleetWeek({ seed, family }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Expected an unsigned 32-bit fleet seed.");
  if (!Object.hasOwn(allPatterns, family)) throw new RangeError("Unknown fleet market " + family);
  const { forecast, boards } = makeTape(seed, family);
  let positions = Object.freeze([0, 1]);
  let epoch = 0;
  let history = Object.freeze([]);
  let ledger = Object.freeze({ net: 0, gross: 0, loadedCost: 0, emptyCost: 0, penalty: 0, served: 0, contracts: 0, emptyMiles: 0 });
  let observation;
  function observe() {
    if (epoch === FLEET_WEEK_EPOCHS) return null;
    const { orders, hub } = boards[epoch];
    observation ??= Object.freeze({ epoch, day: 1 + Math.floor(epoch / 2), period: epoch % 2 === 0 ? "AM" : "PM",
      positions, hub, orders, forecast, history });
    return observation;
  }
  const legalActions = () => fleetWeekActions(observe());
  function step(id) {
    if (epoch === FLEET_WEEK_EPOCHS) throw new RangeError("Fleet week is complete.");
    const action = legalActions().find(candidate => candidate.id === id);
    if (!action) throw new RangeError("Illegal fleet action at epoch " + epoch + ": " + String(id));
    const { orders, hub } = observe();
    const nextLedger = { contracts: epoch + 1 };
    for (const key of sumFields) nextLedger[key] = ledger[key] + action[key];
    ledger = Object.freeze(nextLedger);
    history = Object.freeze([...history, Object.freeze({ epoch, hub, orders })]);
    positions = action.positions;
    epoch++;
    observation = null;
    return { action, ledger, done: epoch === FLEET_WEEK_EPOCHS };
  }
  return Object.freeze({ observe, legalActions, step,
    get done() { return epoch === FLEET_WEEK_EPOCHS; }, get ledger() { return ledger; } });
}

export function runFleetWeek(config, policy) {
  if (typeof policy !== "function") throw new TypeError("A fleet policy must be a function.");
  const session = createFleetWeek(config), trace = [], actions = [];
  while (!session.done) {
    const observation = session.observe();
    const id = policy(observation, session.legalActions());
    const result = session.step(id);
    actions.push(id);
    trace.push({ observation, action: result.action, ledger: result.ledger });
  }
  return { ledger: session.ledger, actions, trace };
}
