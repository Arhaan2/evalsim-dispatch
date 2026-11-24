import { adaptivePlanner, observeTurns, stepTurns, stochasticPlanner, reserveCalls,
  createTurns, TURNS_PATTERNS, verifyTurns } from "./turns.js";

export { adaptivePlanner, observeTurns as observeCloses, stepTurns as stepCloses, stochasticPlanner, reserveCalls };
export const CLOSES_VERSION = "closes-v1.0.0";

// Every stem splits into two branches, crossed with every seed. A level of
// zero uses that seed's cold probability and four uses its hot probability.
// The final two waves hold at the endpoint. Quotes and draws follow Drift v1.
function twins(stem, title, stratum, prefix, cold, hot) {
  return [ ["cold", cold], ["hot", hot] ].map(([ending, tail]) => {
    const family = stem + "-" + ending;
    return [family, Object.freeze({
      stem, stratum, ending, label: title + " · " + ending + " finish",
      description: title + " ends with two " + ending + " waves.",
      levels: Object.freeze([...prefix, ...tail]),
    })];
  });
}

const train = [
  ...twins("flash-crest", "Flash crest", "reversal", [2, 0, 4, 1], [0, 0, 0, 0], [3, 4, 4, 4]),
  ...twins("stair-crest", "Stepped crest", "reversal", [2, 0, 2, 4, 2], [0, 0, 0], [4, 4, 4]),
  ...twins("wide-crest", "Wide crest", "reversal", [2, 0, 3, 3, 2], [1, 0, 0], [3, 4, 4]),
  ...twins("deep-bounce", "Deep rebound", "interrupted-drop", [2, 4, 0, 4, 1], [0, 0, 0], [4, 4, 4]),
  ...twins("gentle-bounce", "Gradual dip", "interrupted-drop", [2, 4, 2, 0, 3], [0, 0, 0], [2, 4, 4]),
  ...twins("short-bounce", "Short rebound", "interrupted-drop", [2, 4, 0, 3], [1, 1, 0, 0], [2, 3, 4, 4]),
];
const validation = [
  ...twins("notched-crest", "Notched crest", "reversal", [2, 1, 4, 4, 1], [1, 0, 0], [4, 4, 4]),
  ...twins("shelf-bounce", "Low plateau", "interrupted-drop", [2, 4, 1, 1, 3], [1, 0, 0], [2, 4, 4]),
];
const test = [
  ...twins("front-crest", "Front-loaded crest", "reversal", [2, 1, 4, 2], [2, 0, 0, 0], [3, 3, 4, 4]),
  ...twins("delayed-crest", "Delayed crest", "reversal", [2, 0, 0, 4, 2], [0, 0, 0], [4, 4, 4]),
  ...twins("drawn-bounce", "Drawn-out rebound", "interrupted-drop", [2, 4, 1, 4], [2, 1, 0, 0], [3, 3, 4, 4]),
  ...twins("delayed-bounce", "Delayed drop", "interrupted-drop", [2, 4, 4, 0, 3], [1, 0, 0], [2, 4, 4]),
];
const retention = ["early-rebound", "late-rebound", "interrupted-drop"].map(family => [
  family, Object.freeze({ ...TURNS_PATTERNS[family], stem: family, ending: "cold" }),
]);

export const CLOSES_PATTERNS = Object.freeze(Object.fromEntries([...train, ...validation, ...test, ...retention]));
function split(start, count, entries) {
  return Object.freeze({ start, count, families: Object.freeze(entries.map(([family]) => family)) });
}
export const CLOSES_SUITE = Object.freeze({
  id: "dispatch-closes-v1",
  splits: Object.freeze({
    train: split(10100000, 60000, train), validation: split(10200000, 128, validation),
    test: split(10300000, 512, test), retention: split(10400000, 512, retention),
  }),
});
export function closesCases(splitName = "test") {
  if (!Object.hasOwn(CLOSES_SUITE.splits, splitName)) throw new RangeError("Unknown closing split.");
  const { start, count, families } = CLOSES_SUITE.splits[splitName];
  return Array.from({ length: count }, (_, i) => families.map(family => ({ split: splitName, seed: start + i, family }))).flat();
}

const lanes = ["Canal Market", "East Wharf", "Ridge Arcade", "Mill Exchange", "Park Stores", "Inlet Market", "Pier Exchange", "Foundry Stores"];
const costs = [3, 5, 4, 6, 3, 4, 5, 6];
const supports = [
  [[9, 18], [8, 22], [6, 24], [7, 28], [4, 30], [7, 24], [4, 34], [4, 32]],
  [[8, 22], [9, 18], [7, 28], [6, 24], [7, 24], [4, 30], [4, 32], [4, 34]],
];

// Pricing follows the frozen v1 draw order. Neither the chosen branch nor
// bookings change the underlying price support, survey noise or offer draws.
function closingTape(seed, levels) {
  let rng = seed >>> 0;
  function draw() {
    rng = (rng + 0x6d2b79f5) >>> 0;
    let word = Math.imul(rng ^ (rng >>> 15), rng | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  const support = supports[Math.floor(draw() * supports.length)];
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
    offers.push({ lane: lanes[wave], cost: costs[wave], revenue: net + costs[wave], net });
  }
  return { trueHighChances, board, offers };
}

export function createCloses({ seed, family = CLOSES_SUITE.splits.test.families[0] }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(CLOSES_PATTERNS, family)) throw new RangeError("Unknown closing pattern.");
  if (CLOSES_SUITE.splits.retention.families.includes(family)) return createTurns({ seed, family });
  return { seed, family, ...closingTape(seed, CLOSES_PATTERNS[family].levels),
    wave: 0, slots: 2, net: 0, done: false, calls: [], loads: [] };
}

export function verifyCloses(s) {
  if (CLOSES_SUITE.splits.retention.families.includes(s.family)) return verifyTurns(s);
  const { offers } = closingTape(s.seed, CLOSES_PATTERNS[s.family].levels);
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
