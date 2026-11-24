import { createCloses } from "./closes.js";
import { adaptivePlanner, createTrust, observeTrust, reserveCalls, stepTrust, stochasticPlanner,
  TRUST_PATTERNS, TRUST_SUITE, verifyTrust } from "./trust.js";

export { adaptivePlanner, observeTrust as observeRally, reserveCalls, stepTrust as stepRally, stochasticPlanner };
export const RALLY_VERSION = "rally-v1.0.0";

// Each twin warms before it forks. The signed offers are random, so that
// change in underlying demand need not produce an immediate high offer.
function twins(stem, title, stratum, opening, cold, hot) {
  return [["cold", cold], ["hot", hot]].map(([ending, tail]) => [stem + "-" + ending, Object.freeze({
    stem, stratum, ending, label: title + " · " + ending + " finish",
    description: "The first " + opening.length + " waves include a shared rally. Demand "
      + (ending === "hot" ? "stays strong or recovers again before the close." : "cools before the close."),
    prefixLength: opening.length, levels: Object.freeze([...opening, ...tail]),
  })]);
}
const pairedTraining = [
  ...twins("first-lift", "Early lift", "reversal", [2, 0, 3], [2, 1, 1, 1, 0], [4, 4, 3, 3, 4]),
  ...twins("slow-lift", "Slow lift", "reversal", [2, 1, 1, 3], [2, 2, 1, 0], [4, 3, 3, 4]),
  ...twins("steady-lift", "Steady lift", "reversal", [2, 0, 2, 3], [2, 1, 1, 0], [3, 3, 4, 4]),
  ...twins("long-lift", "Long lift", "reversal", [2, 0, 1, 3, 4], [1, 1, 0], [3, 3, 4]),
  ...twins("first-rebound", "Early rebound", "interrupted-drop", [2, 3, 0, 3], [2, 0, 1, 0], [4, 3, 3, 4]),
  ...twins("shelf-rebound", "Rebounding plateau", "interrupted-drop", [2, 4, 2, 2, 3], [1, 1, 0], [4, 3, 4]),
  ...twins("gradual-rebound", "Gradual rebound", "interrupted-drop", [2, 3, 1, 2], [1, 2, 1, 0], [3, 4, 3, 4]),
  ...twins("slow-rebound", "Slow rebound", "interrupted-drop", [2, 4, 3, 1, 3], [2, 1, 0], [4, 4, 4]),
];
const validation = [
  ...twins("midway-lift", "Mid-shift lift", "reversal", [2, 1, 3], [4, 2, 2, 1, 0], [3, 4, 3, 4, 4]),
  ...twins("short-lived-rebound", "Rebound plateau", "interrupted-drop", [2, 3, 2, 3, 3], [2, 1, 0], [4, 4, 4]),
];
const test = [
  ...twins("narrow-lift", "Early rally", "reversal", [2, 1, 2], [3, 3, 1, 1, 0], [4, 2, 4, 3, 4]),
  ...twins("delayed-lift", "Late rally", "reversal", [2, 1, 1, 2, 3], [2, 1, 0], [4, 4, 4]),
  ...twins("quick-recovery", "Sharp rebound", "interrupted-drop", [2, 3, 1, 4], [3, 2, 1, 0], [4, 3, 3, 4]),
  ...twins("broad-recovery", "Delayed rebound", "interrupted-drop", [2, 3, 3, 1, 4], [2, 1, 0], [4, 3, 4]),
];
const legacy = families => families.map(family => [family, TRUST_PATTERNS[family]]);
const train = [...pairedTraining, ...legacy(["brief-bounce", "held-bounce", "rounded-bounce"])];
const retention = legacy(["interrupted-drop"]);
const archive = legacy(TRUST_SUITE.splits.test.families);
export const RALLY_PATTERNS = Object.freeze(Object.fromEntries([...train, ...validation, ...test, ...retention, ...archive]));

function split(start, count, entries) {
  return Object.freeze({ start, count, families: Object.freeze(entries.map(([family]) => family)) });
}
export const RALLY_SUITE = Object.freeze({
  id: "dispatch-rally-v1", splits: Object.freeze({
    train: split(12100000, 60000, train), validation: split(12200000, 128, validation),
    test: split(12300000, 1024, test), retention: split(12400000, 1024, retention),
    archive: split(12500000, 1024, archive),
  }),
});
export function rallyCases(splitName = "test") {
  if (!Object.hasOwn(RALLY_SUITE.splits, splitName)) throw new RangeError("Unknown rally split.");
  const { start, count, families } = RALLY_SUITE.splits[splitName];
  return Array.from({ length: count }, (_, i) => families.map(family => ({ split: splitName, seed: start + i, family }))).flat();
}

function nativeShift(seed, family) {
  // Inherit the released simulator's lane prices, truck ledger, market odds
  // and initial bulletin from a path that reaches both probability endpoints.
  const state = createCloses({ seed, family: "flash-crest-cold" });
  const cold = Math.min(...state.trueHighChances), hot = Math.max(...state.trueHighChances);
  state.family = family;
  state.trueHighChances = RALLY_PATTERNS[family].levels.map(level => cold + (hot - cold) * level / 4);

  // Continue the original market tape past its four opening draws. Each
  // twin consumes exactly the same survey noise and signed-offer uniforms.
  let counter = (seed + 4 * 0x6d2b79f5) >>> 0;
  function draw() {
    counter = (counter + 0x6d2b79f5) >>> 0;
    let word = Math.imul(counter ^ (counter >>> 15), counter | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  let bulletin = state.board[0].highChance;
  for (const [wave, quote] of state.board.entries()) {
    if (wave === 3 || wave === 6) {
      const noise = (Math.floor(draw() * 3) - 1) / 10;
      bulletin = Math.max(0.1, Math.min(0.9, Math.round((state.trueHighChances[wave - 2] + noise) * 10) / 10));
    }
    quote.highChance = bulletin;
    quote.mean = quote.low + bulletin * (quote.high - quote.low);
    const offer = state.offers[wave];
    offer.net = draw() < state.trueHighChances[wave] ? quote.high : quote.low;
    offer.revenue = offer.cost + offer.net;
  }
  return state;
}

export function createRally({ seed, family = RALLY_SUITE.splits.test.families[0] }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(RALLY_PATTERNS, family)) throw new RangeError("Unknown rally pattern.");
  return Object.hasOwn(TRUST_PATTERNS, family) ? createTrust({ seed, family }) : nativeShift(seed, family);
}

export function verifyRally(state) {
  if (Object.hasOwn(TRUST_PATTERNS, state.family)) return verifyTrust(state);
  // Rebuild from the private case definition, so editing a signed load, its
  // mutable offer and the ledger together still fails verification.
  const rebuilt = createRally({ seed: state.seed, family: state.family });
  const violations = [];
  if (!Number.isInteger(state.wave) || state.wave < 0 || state.wave > rebuilt.offers.length ||
      state.calls.length !== state.wave || state.done !== (state.wave === rebuilt.offers.length)) violations.push("Wave clock mismatch.");
  let accepted = 0, net = 0;
  for (const [wave, call] of state.calls.entries()) {
    if (call.wave !== wave || !["accept", "pass"].includes(call.id)) violations.push("Invalid decision log.");
    if (call.id !== "accept") continue;
    const offer = rebuilt.offers[wave], load = state.loads[accepted++];
    if (!offer || !load || load.wave !== wave || load.lane !== offer.lane || load.cost !== offer.cost ||
        load.revenue !== offer.revenue) violations.push("Signed load mismatch.");
    if (offer) net += offer.revenue - offer.cost;
  }
  if (accepted !== state.loads.length || accepted > rebuilt.slots || state.slots !== rebuilt.slots - accepted) violations.push("Capacity mismatch.");
  if (net !== state.net) violations.push("Contribution mismatch.");
  return { net, accepted, usedSlots: accepted, capacity: rebuilt.slots, waves: state.wave, violations };
}
