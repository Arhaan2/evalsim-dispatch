import { adaptivePlanner, CLOSES_PATTERNS, CLOSES_SUITE, createCloses, observeCloses,
  reserveCalls, stepCloses, stochasticPlanner, verifyCloses } from "./closes.js";
import { createTurns, TURNS_PATTERNS, verifyTurns } from "./turns.js";

export { adaptivePlanner, observeCloses as observeTrust, reserveCalls, stepCloses as stepTrust, stochasticPlanner };
export const TRUST_VERSION = "trust-v1.0.0";

function twins(stem, title, stratum, prefix, cold, hot) {
  return [["cold", cold], ["hot", hot]].map(([ending, tail]) => [stem + "-" + ending, Object.freeze({
    stem, stratum, ending, label: title + " · " + ending + " finish",
    description: "The two " + title.toLowerCase() + " cases share their first " + prefix.length + " waves.",
    levels: Object.freeze([...prefix, ...tail]),
  })]);
}
const newTrain = [
  ...twins("backstep-crest", "Double crest", "reversal", [2, 0, 4, 1], [2, 1, 0, 0], [3, 2, 4, 4]),
  ...twins("fading-bounce", "Fading rebound", "interrupted-drop", [2, 4, 0, 3, 1], [1, 1, 0], [3, 3, 4]),
];
const validation = [
  ...twins("sloped-crest", "Sloping crest", "reversal", [2, 1, 3, 4, 3], [1, 0, 0], [3, 4, 4]),
  ...twins("long-bounce", "Long recovery", "interrupted-drop", [2, 4, 0, 1, 3], [2, 1, 0], [1, 4, 4]),
];
const test = [
  ...twins("crest-shelf", "Crest plateau", "reversal", [2, 1, 3, 4, 4], [1, 0, 0], [2, 4, 4]),
  ...twins("repeat-crest", "Interrupted crest", "reversal", [2, 0, 4, 2], [2, 1, 0, 0], [3, 2, 3, 4]),
  ...twins("brief-rally", "Brief rally", "interrupted-drop", [2, 4, 1, 3], [3, 2, 0, 0], [2, 2, 3, 4]),
  ...twins("deep-dip", "Deep dip", "interrupted-drop", [2, 4, 2, 0, 3], [1, 1, 0], [2, 3, 4]),
];
const trainingRecoveries = ["brief-bounce", "held-bounce", "rounded-bounce"];
const coldTraining = trainingRecoveries.map(family => [family, Object.freeze({
  ...TURNS_PATTERNS[family], stem: family, ending: "cold",
})]);
const legacy = families => families.map(family => [family, CLOSES_PATTERNS[family]]);
const train = [...legacy(CLOSES_SUITE.splits.train.families), ...newTrain, ...coldTraining];
const retention = legacy(["interrupted-drop"]);
const archive = legacy(CLOSES_SUITE.splits.test.families);
export const TRUST_PATTERNS = Object.freeze(Object.fromEntries([...train, ...validation, ...test, ...retention, ...archive]));

function split(start, count, entries) {
  return Object.freeze({ start, count, families: Object.freeze(entries.map(([family]) => family)) });
}
export const TRUST_SUITE = Object.freeze({
  id: "dispatch-trust-v1",
  splits: Object.freeze({
    train: split(11100000, 60000, train), validation: split(11200000, 128, validation),
    test: split(11300000, 1024, test), retention: split(11400000, 1024, retention),
    archive: split(11500000, 1024, archive),
  }),
});
export function trustCases(splitName = "test") {
  if (!Object.hasOwn(TRUST_SUITE.splits, splitName)) throw new RangeError("Unknown trust split.");
  const { start, count, families } = TRUST_SUITE.splits[splitName];
  return Array.from({ length: count }, (_, i) => families.map(family => ({ split: splitName, seed: start + i, family }))).flat();
}

// Take lane contracts, handling costs, signed price supports, the opening
// bulletin and initial resource ledger from the unchanged Closes generator.
// Replay its market draws against the new demand path.
function freshState(seed, family) {
  const s = createCloses({ seed, family: "flash-crest-cold" });
  const cold = Math.min(...s.trueHighChances), hot = Math.max(...s.trueHighChances);
  const levels = TRUST_PATTERNS[family].levels;
  s.family = family;
  s.trueHighChances = levels.map(level => cold + (hot - cold) * level / 4);
  // Closes consumes four draws for its price schedule, cold and hot odds, and opening bulletin.
  let counter = (seed + 4 * 0x6d2b79f5) >>> 0;
  function draw() {
    counter = (counter + 0x6d2b79f5) >>> 0;
    let word = Math.imul(counter ^ (counter >>> 15), counter | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  let bulletin = s.board[0].highChance;
  for (const [wave, quote] of s.board.entries()) {
    if (wave === 3 || wave === 6) {
      const noise = (Math.floor(draw() * 3) - 1) / 10;
      bulletin = Math.max(0.1, Math.min(0.9, Math.round((s.trueHighChances[wave - 2] + noise) * 10) / 10));
    }
    quote.highChance = bulletin;
    quote.mean = quote.low + (quote.high - quote.low) * bulletin;
    const offer = s.offers[wave];
    offer.net = draw() < s.trueHighChances[wave] ? quote.high : quote.low;
    offer.revenue = offer.cost + offer.net;
  }
  return s;
}

export function createTrust({ seed, family = TRUST_SUITE.splits.test.families[0] }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(TRUST_PATTERNS, family)) throw new RangeError("Unknown trust pattern.");
  if (Object.hasOwn(CLOSES_PATTERNS, family)) return createCloses({ seed, family });
  if (Object.hasOwn(TURNS_PATTERNS, family)) return createTurns({ seed, family });
  return freshState(seed, family);
}

export function verifyTrust(s) {
  if (Object.hasOwn(CLOSES_PATTERNS, s.family)) return verifyCloses(s);
  if (Object.hasOwn(TURNS_PATTERNS, s.family)) return verifyTurns(s);
  const { offers } = freshState(s.seed, s.family);
  const violations = [];
  if (!Number.isInteger(s.wave) || s.wave < 0 || s.wave > offers.length || s.calls.length !== s.wave ||
      s.done !== (s.wave === offers.length)) violations.push("Wave clock mismatch.");
  let accepted = 0, net = 0;
  for (const [wave, call] of s.calls.entries()) {
    if (call.wave !== wave || !["accept", "pass"].includes(call.id)) violations.push("Invalid decision log.");
    if (call.id !== "accept") continue;
    const offer = offers[wave], load = s.loads[accepted++];
    if (!offer || !load || load.wave !== wave || load.lane !== offer.lane ||
        load.cost !== offer.cost || load.revenue !== offer.revenue) violations.push("Signed load mismatch.");
    if (offer) net += offer.revenue - offer.cost;
  }
  if (accepted !== s.loads.length || accepted > 2 || s.slots !== 2 - accepted) violations.push("Capacity mismatch.");
  if (net !== s.net) violations.push("Contribution mismatch.");
  return { net, accepted, usedSlots: accepted, capacity: 2, waves: s.wave, violations };
}
