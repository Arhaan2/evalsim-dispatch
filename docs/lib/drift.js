import { observeReserve, reserveCalls, stepReserve, stochasticPlanner } from "./reserve.js";

export { reserveCalls, stochasticPlanner };
export const DRIFT_VERSION = "drift-v1.0.0";

function split(start, count, families) {
  return Object.freeze({ start, count, families: Object.freeze(families) });
}

export const DRIFT_SUITE = Object.freeze({
  id: "dispatch-drift-v1",
  splits: Object.freeze({
    train: split(8100000, 60000, ["step-up", "step-down", "ramp-up", "ramp-down"]),
    validation: split(8200000, 64, ["plateau-rise", "plateau-fall"]),
    test: split(8300000, 256, ["reversal", "double-pulse", "interrupted-drop"]),
  }),
});

function pattern(label, description, levels) {
  return Object.freeze({ label, description, levels: Object.freeze(levels) });
}

// All patterns open at the same neutral level. Levels 0 to 4 interpolate
// between the cold and hot probabilities of this seed. After the opening,
// fitting and validation cover one-way movements. Test paths change direction.
export const DRIFT_PATTERNS = Object.freeze({
  "step-up": pattern("Step up", "Cold demand jumps to a sustained hot market.", [2, 0, 0, 0, 4, 4, 4, 4]),
  "step-down": pattern("Step down", "Hot demand drops to a sustained cold market.", [2, 4, 4, 4, 0, 0, 0, 0]),
  "ramp-up": pattern("Ramp up", "Demand climbs gradually through the shift.", [2, 0, 0, 1, 2, 3, 4, 4]),
  "ramp-down": pattern("Ramp down", "Demand falls gradually through the shift.", [2, 4, 4, 3, 2, 1, 0, 0]),
  "plateau-rise": pattern("Rising plateau", "Demand pauses halfway through its climb.", [2, 0, 2, 2, 2, 2, 4, 4]),
  "plateau-fall": pattern("Falling plateau", "Demand pauses halfway through its decline.", [2, 4, 2, 2, 2, 2, 0, 0]),
  reversal: pattern("Reversal", "A cold market heats up, then drops back before the close.", [2, 0, 0, 4, 4, 4, 0, 0]),
  "double-pulse": pattern("Double pulse", "Two bursts of hot demand interrupt a cold market.", [2, 0, 4, 0, 0, 4, 4, 0]),
  "interrupted-drop": pattern("Interrupted drop", "A falling market briefly rebounds, then falls again.", [2, 4, 4, 0, 0, 4, 0, 0]),
});

const LANES = ["Canal Market", "East Wharf", "Ridge Arcade", "Mill Exchange",
  "Park Stores", "Inlet Market", "Pier Exchange", "Foundry Stores"];
const COSTS = [3, 5, 4, 6, 3, 4, 5, 6];
const SUPPORTS = [
  [[9, 18], [8, 22], [6, 24], [7, 28], [4, 30], [7, 24], [4, 34], [4, 32]],
  [[8, 22], [9, 18], [7, 28], [6, 24], [7, 24], [4, 30], [4, 32], [4, 34]],
];

export function driftCases(splitName = "test") {
  if (!Object.hasOwn(DRIFT_SUITE.splits, splitName)) throw new RangeError("Unknown drift split.");
  const { start, count, families } = DRIFT_SUITE.splits[splitName];
  return Array.from({ length: count }, (_, i) =>
    families.map(family => ({ split: splitName, seed: start + i, family }))).flat();
}

function quote(low, high, highChance) {
  return { low, high, highChance, mean: low + highChance * (high - low) };
}

function freightTape(seed, family) {
  let state = seed >>> 0;
  function draw() {
    state = (state + 0x6d2b79f5) >>> 0;
    let word = Math.imul(state ^ (state >>> 15), state | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  const support = SUPPORTS[Math.floor(draw() * SUPPORTS.length)];
  const cold = draw() < 0.5 ? 0.10 : 0.20, hot = draw() < 0.5 ? 0.75 : 0.85;
  const trueHighChances = DRIFT_PATTERNS[family].levels.map(level => cold + (hot - cold) * level / 4);
  let bulletin = draw() < 0.5 ? 0.40 : 0.50;
  const board = [], offers = [];
  for (const [wave, [low, high]] of support.entries()) {
    // Before waves 4 and 7 (one-based), the desk samples a two-wave-old
    // market survey, with additive noise of -10, 0 or +10 percentage points.
    if (wave === 3 || wave === 6) {
      const noise = (Math.floor(draw() * 3) - 1) / 10;
      bulletin = Math.max(0.1, Math.min(0.9, Math.round((trueHighChances[wave - 2] + noise) * 10) / 10));
    }
    board.push(quote(low, high, bulletin));
    const net = draw() < trueHighChances[wave] ? high : low;
    offers.push({ lane: LANES[wave], cost: COSTS[wave], revenue: net + COSTS[wave], net });
  }
  return { trueHighChances, board, offers };
}

export function createDrift({ seed, family = "reversal" }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(DRIFT_PATTERNS, family)) throw new RangeError("Unknown demand pattern.");
  return { seed, family, ...freightTape(seed, family), wave: 0, slots: 2, net: 0, done: false, calls: [], loads: [] };
}

function publicObservation(s, base) {
  const current = s.done ? null : { ...s.board[s.wave] };
  // Keep future price supports public, and replace all future survey updates
  // with today's bulletin. Operators cannot see tomorrow's survey or draws.
  const forecast = base.forecast.map(f => quote(f.low, f.high, current.highChance));
  const history = s.offers.slice(0, s.wave).map((offer, wave) => ({
    wave, offer: { ...offer }, quote: { ...s.board[wave] }, high: offer.net === s.board[wave].high,
  }));
  return { ...base, quote: current, forecast, history };
}

export function observeDrift(s) {
  return publicObservation(s, observeReserve(s));
}

export function stepDrift(s, id) {
  // Capacity, charges and the eight calls per shift use the shipped Reserve ledger.
  return publicObservation(s, stepReserve(s, id));
}

export function verifyDrift(s) {
  const { offers } = freightTape(s.seed, s.family);
  const violations = [];
  if (!Number.isInteger(s.wave) || s.wave < 0 || s.wave > offers.length ||
      s.calls.length !== s.wave || s.done !== (s.wave === offers.length)) violations.push("Wave clock mismatch.");
  let accepted = 0, net = 0;
  for (const [wave, call] of s.calls.entries()) {
    if (call.wave !== wave || !["accept", "pass"].includes(call.id)) violations.push("Invalid decision log.");
    if (call.id !== "accept") continue;
    const offer = offers[wave], load = s.loads[accepted++];
    if (!offer || !load || load.wave !== wave || load.lane !== offer.lane ||
        load.revenue !== offer.revenue || load.cost !== offer.cost) violations.push("Signed load mismatch.");
    if (offer) net += offer.revenue - offer.cost;
  }
  if (s.loads.length !== accepted || accepted > 2 || s.slots !== 2 - accepted) violations.push("Capacity mismatch.");
  if (s.net !== net) violations.push("Contribution mismatch.");
  return { net, accepted, usedSlots: accepted, capacity: 2, waves: s.wave, violations };
}

// Use all signed offers, including the current one, to update a public
// forecast residual. The latest residual gets half the weight. Its effect
// on future odds attenuates by 25% per additional wave of lookahead.
export function adaptivePlanner(o) {
  if (o.done || !o.slots) return stochasticPlanner(o);
  let residual = 0;
  for (const entry of o.history) residual = 0.5 * residual + 0.5 * (Number(entry.high) - entry.quote.highChance);
  residual = 0.5 * residual + 0.5 * (Number(o.offer.net === o.quote.high) - o.quote.highChance);
  const forecast = o.forecast.map(f => {
    const p = Math.max(0.05, Math.min(0.95, f.highChance + residual));
    residual *= 0.75;
    return quote(f.low, f.high, p);
  });
  return stochasticPlanner({ ...o, forecast });
}
