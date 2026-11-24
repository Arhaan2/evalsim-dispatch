import {
  adaptivePlanner, createDrift, DRIFT_PATTERNS, observeDrift, reserveCalls, stepDrift,
  stochasticPlanner, verifyDrift,
} from "./drift.js";

// The observation, capacity transitions and public planners are the released Drift implementations.
export { adaptivePlanner, observeDrift as observeTurns, reserveCalls, stepDrift as stepTurns, stochasticPlanner };
export const TURNS_VERSION = "turns-v1.0.0";

function split(start, count, families) {
  return Object.freeze({ start, count, families: Object.freeze(families) });
}

export const TURNS_SUITE = Object.freeze({
  id: "dispatch-turns-v1",
  splits: Object.freeze({
    train: split(9100000, 60000, ["brief-peak", "held-peak", "rounded-peak", "brief-bounce", "held-bounce", "rounded-bounce"]),
    validation: split(9200000, 64, ["middle-crest", "middle-rebound"]),
    test: split(9300000, 256, ["early-crest", "late-crest", "early-rebound", "late-rebound"]),
    retention: split(9400000, 256, ["interrupted-drop"]),
  }),
});

function pattern(stratum, label, description, levels) {
  return Object.freeze({ stratum, label, description, levels: Object.freeze(levels) });
}

// Eight latent levels interpolate between each tape's cold and hot probabilities.
// Freeze the schedules separately from seeds: adjacent plateaus and their durations
// determine when a change occurs. The original path is evaluated in a separate split.
export const TURNS_PATTERNS = Object.freeze({
  "brief-peak": pattern("reversal", "Brief peak", "A single early hot wave passes before demand cools.", [2, 0, 4, 0, 0, 0, 0, 0]),
  "held-peak": pattern("reversal", "Sustained peak", "Four hot waves follow a cold start.", [2, 0, 4, 4, 4, 4, 0, 0]),
  "rounded-peak": pattern("reversal", "Rounded peak", "Demand climbs gradually, peaks and falls.", [2, 0, 1, 3, 4, 3, 1, 0]),
  "brief-bounce": pattern("interrupted-drop", "Brief bounce", "A hot opening falls, bounces for one wave and stays cold.", [2, 4, 0, 4, 0, 0, 0, 0]),
  "held-bounce": pattern("interrupted-drop", "Sustained bounce", "A one-wave dip interrupts hot demand before the closing fall.", [2, 4, 4, 0, 4, 4, 0, 0]),
  "rounded-bounce": pattern("interrupted-drop", "Rounded bounce", "Demand falls gradually, recovers partway and cools again.", [2, 4, 2, 0, 1, 3, 1, 0]),
  "middle-crest": pattern("reversal", "Mid-shift crest", "A two-wave hot spell follows two cold waves.", [2, 0, 0, 4, 4, 0, 0, 0]),
  "middle-rebound": pattern("interrupted-drop", "Mid-shift rebound", "An early fall gives way to a two-wave recovery.", [2, 4, 0, 0, 4, 4, 0, 0]),
  "early-crest": pattern("reversal", "Early crest", "Demand peaks on waves three and four, then stays cold.", [2, 0, 4, 4, 0, 0, 0, 0]),
  "late-crest": pattern("reversal", "Late crest", "Demand stays cold until wave five, holds hot for three waves and falls at close.", [2, 0, 0, 0, 4, 4, 4, 0]),
  "early-rebound": pattern("interrupted-drop", "Early rebound", "A hot opening dips, rebounds on waves four and five, and cools again.", [2, 4, 0, 4, 4, 0, 0, 0]),
  "late-rebound": pattern("interrupted-drop", "Late rebound", "A hot opening falls for three waves, rebounds on wave seven and cools at close.", [2, 4, 4, 0, 0, 0, 4, 0]),
  "interrupted-drop": Object.freeze({ ...DRIFT_PATTERNS["interrupted-drop"], stratum: "interrupted-drop" }),
});

export function turnsCases(splitName = "test") {
  if (!Object.hasOwn(TURNS_SUITE.splits, splitName)) throw new RangeError("Unknown turns split.");
  const { start, count, families } = TURNS_SUITE.splits[splitName];
  return Array.from({ length: count }, (_, i) =>
    families.map(family => ({ split: splitName, seed: start + i, family }))).flat();
}

// Preserve the signed price supports, lane costs, survey lag, survey noise and
// order of exogenous draws from Drift v1. Only the event schedule is different.
const LANES = ["Canal Market", "East Wharf", "Ridge Arcade", "Mill Exchange",
  "Park Stores", "Inlet Market", "Pier Exchange", "Foundry Stores"];
const COSTS = [3, 5, 4, 6, 3, 4, 5, 6];
const SUPPORTS = [
  [[9, 18], [8, 22], [6, 24], [7, 28], [4, 30], [7, 24], [4, 34], [4, 32]],
  [[8, 22], [9, 18], [7, 28], [6, 24], [7, 24], [4, 30], [4, 32], [4, 34]],
];

function freightTape(seed, levels) {
  let randomState = seed >>> 0;
  function draw() {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let word = Math.imul(randomState ^ (randomState >>> 15), randomState | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  const support = SUPPORTS[Math.floor(draw() * SUPPORTS.length)];
  const cold = draw() < 0.5 ? 0.10 : 0.20, hot = draw() < 0.5 ? 0.75 : 0.85;
  const trueHighChances = levels.map(level => cold + (hot - cold) * level / 4);
  let bulletin = draw() < 0.5 ? 0.40 : 0.50;
  const board = [], offers = [];
  for (const [wave, [low, high]] of support.entries()) {
    if (wave === 3 || wave === 6) {
      const noise = (Math.floor(draw() * 3) - 1) / 10;
      bulletin = Math.max(0.1, Math.min(0.9, Math.round((trueHighChances[wave - 2] + noise) * 10) / 10));
    }
    board.push({ low, high, highChance: bulletin, mean: low + bulletin * (high - low) });
    const net = draw() < trueHighChances[wave] ? high : low;
    offers.push({ lane: LANES[wave], cost: COSTS[wave], revenue: net + COSTS[wave], net });
  }
  return { trueHighChances, board, offers };
}

export function createTurns({ seed, family = "early-crest" }) {
  if (family === "interrupted-drop") return createDrift({ seed, family });
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(TURNS_PATTERNS, family)) throw new RangeError("Unknown turn pattern.");
  const tape = freightTape(seed, TURNS_PATTERNS[family].levels);
  return { seed, family, ...tape, wave: 0, slots: 2, net: 0, done: false, calls: [], loads: [] };
}

export function verifyTurns(s) {
  if (s.family === "interrupted-drop") return verifyDrift(s);
  const { offers } = freightTape(s.seed, TURNS_PATTERNS[s.family].levels);
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
