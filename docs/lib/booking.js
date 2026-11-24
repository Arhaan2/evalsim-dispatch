import { createCloses } from "./closes.js";
import { adaptivePlanner, createSurvey, observeSurvey, reserveCalls, stepSurvey, stochasticPlanner,
  SURVEY_PATTERNS, SURVEY_SUITE, verifySurvey } from "./survey.js";

export { adaptivePlanner, observeSurvey as observeBooking, reserveCalls, stepSurvey as stepBooking, stochasticPlanner };
export const BOOKING_VERSION = "booking-v1.0.0";

// Each row holds an opening followed by the two possible continuations.
// The same seed fixes prices, draws, and survey noise in both endings.
// Length-four openings fork at wave five; length-five openings at wave six.
const trainingReversals = [
  [[2, 1, 4, 2], [3, 2, 1, 0], [1, 3, 4, 4]],
  [[2, 1, 1, 1, 1], [4, 0, 0], [3, 3, 4]],
  [[2, 0, 0, 2], [0, 2, 0, 0], [1, 1, 4, 4]],
  [[2, 1, 1, 4, 2], [1, 1, 0], [3, 3, 4]],
  [[2, 1, 0, 0], [0, 2, 1, 0], [1, 1, 4, 4]],
  [[2, 1, 0, 4, 3], [1, 1, 0], [2, 3, 4]],
  [[2, 1, 1, 2], [3, 4, 1, 0], [4, 4, 3, 4]],
  [[2, 0, 4, 2, 1], [3, 0, 0], [1, 3, 4]],
  [[2, 0, 2, 2], [0, 1, 0, 0], [2, 1, 3, 4]],
  [[2, 1, 1, 2, 3], [3, 0, 0], [4, 3, 4]],
  [[2, 1, 2, 4], [2, 3, 0, 0], [3, 1, 3, 4]],
  [[2, 0, 1, 0, 2], [1, 1, 0], [3, 4, 4]],
];
const trainingDrops = [
  [[2, 4, 4, 0], [1, 1, 1, 0], [2, 3, 4, 4]],
  [[2, 4, 2, 1, 1], [2, 1, 0], [4, 4, 4]],
  [[2, 3, 3, 2], [1, 4, 0, 0], [3, 4, 3, 4]],
  [[2, 3, 3, 0, 1], [3, 1, 0], [4, 4, 4]],
  [[2, 3, 1, 0], [2, 0, 1, 0], [1, 2, 4, 4]],
  [[2, 4, 0, 0, 4], [3, 1, 0], [2, 3, 4]],
  [[2, 4, 2, 0], [0, 4, 0, 0], [2, 2, 3, 4]],
  [[2, 4, 4, 4, 0], [1, 1, 0], [2, 4, 4]],
  [[2, 4, 2, 1], [3, 4, 0, 0], [4, 4, 3, 4]],
  [[2, 3, 0, 2, 3], [3, 1, 0], [2, 3, 4]],
  [[2, 3, 4, 0], [4, 2, 1, 0], [3, 4, 3, 4]],
  [[2, 4, 3, 3, 0], [2, 0, 0], [3, 3, 4]],
];
const recoveryLevels = [
  [2, 4, 2, 1, 0, 4, 1, 0],
  [2, 3, 4, 0, 2, 3, 0, 0],
  [2, 4, 2, 1, 0, 3, 0, 0],
  [2, 3, 4, 2, 1, 4, 1, 0],
  [2, 4, 4, 1, 3, 1, 1, 0],
  [2, 3, 4, 1, 0, 4, 0, 0],
  [2, 4, 4, 2, 1, 4, 1, 0],
  [2, 3, 4, 1, 4, 1, 0, 0],
  [2, 4, 4, 1, 3, 4, 0, 0],
];

function twins(stem, title, stratum, [opening, cold, hot]) {
  return [["cold", cold], ["hot", hot]].map(([ending, tail]) => [stem + "-" + ending, Object.freeze({
    stem, stratum, ending, label: title + " · " + ending + " finish",
    description: "Identical opening offers and surveys through wave " + opening.length + ".",
    prefixLength: opening.length, levels: Object.freeze([...opening, ...tail]),
  })]);
}

function trainingPairs(stratum, schedules) {
  const label = stratum === "reversal" ? "Reversal" : "Interrupted drop";
  return schedules.flatMap((row, index) => twins("booking-" + stratum + "-" + (index + 1),
    label + " " + (index + 1), stratum, row));
}

const validation = [
  ...twins("late-shelf", "Late shelf", "reversal", [[2, 0, 3, 3, 4], [2, 1, 0], [4, 3, 4]]),
  ...twins("returning-load", "Returning demand", "interrupted-drop", [[2, 3, 4, 1, 2], [2, 0, 0], [4, 4, 4]]),
];
const test = [
  ...twins("level-lift", "Lift from a plateau", "reversal", [[2, 0, 0, 3], [0, 1, 1, 0], [2, 1, 4, 4]]),
  ...twins("rising-shelf", "Rising shelf", "reversal", [[2, 1, 0, 2, 4], [1, 1, 0], [2, 3, 4]]),
  ...twins("shallow-slide", "Shallow slide", "interrupted-drop", [[2, 3, 2, 1], [0, 1, 1, 0], [1, 3, 3, 4]]),
  ...twins("second-surge", "Second surge", "interrupted-drop", [[2, 3, 4, 3, 4], [4, 1, 0], [2, 3, 4]]),
];

const originalLike = recoveryLevels.map((levels, i) => {
  const stem = "booking-recovery-" + (i + 1);
  return [stem, Object.freeze({ stem, stratum: "interrupted-drop", ending: "cold",
    label: "Interrupted recovery " + (i + 1),
    description: "Early warm demand falls, recovers briefly, and closes cold.",
    levels: Object.freeze(levels),
  })];
});
const train = [...trainingPairs("reversal", trainingReversals), ...trainingPairs("interrupted-drop", trainingDrops), ...originalLike];
const legacy = families => families.map(family => [family, SURVEY_PATTERNS[family]]);
const retention = legacy(["interrupted-drop"]);
const archive = legacy(SURVEY_SUITE.splits.test.families);
export const BOOKING_PATTERNS = Object.freeze(Object.fromEntries([...train, ...validation, ...test, ...retention, ...archive]));

function split(start, count, entries) {
  return Object.freeze({ start, count, families: Object.freeze(entries.map(([family]) => family)) });
}
export const BOOKING_SUITE = Object.freeze({
  id: "dispatch-booking-v1", splits: Object.freeze({
    train: split(14100000, 60000, train), validation: split(14200000, 128, validation),
    test: split(14300000, 1024, test), retention: split(14400000, 1024, retention),
    archive: split(14500000, 1024, archive),
  }),
});
export function bookingCases(splitName = "test") {
  if (!Object.hasOwn(BOOKING_SUITE.splits, splitName)) throw new RangeError("Unknown booking split.");
  const { start, count, families } = BOOKING_SUITE.splits[splitName];
  return Array.from({ length: count }, (_, i) => families.map(family => ({ split: splitName, seed: start + i, family }))).flat();
}

function nativeShift(seed, family) {
  // Inherit the released simulator's lane prices, truck ledger, market odds
  // and initial bulletin from a path that reaches both probability endpoints.
  const state = createCloses({ seed, family: "flash-crest-cold" });
  const cold = Math.min(...state.trueHighChances), hot = Math.max(...state.trueHighChances);
  state.family = family;
  state.trueHighChances = BOOKING_PATTERNS[family].levels.map(level => cold + (hot - cold) * level / 4);

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

export function createBooking({ seed, family = BOOKING_SUITE.splits.test.families[0] }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(BOOKING_PATTERNS, family)) throw new RangeError("Unknown booking pattern.");
  return Object.hasOwn(SURVEY_PATTERNS, family) ? createSurvey({ seed, family }) : nativeShift(seed, family);
}
export function verifyBooking(state) {
  if (Object.hasOwn(SURVEY_PATTERNS, state.family)) return verifySurvey(state);
  // Replay from the sealed market definition, independently of mutable loads
  // and offers. A forged booking and a matching forged balance both fail.
  const rebuilt = createBooking({ seed: state.seed, family: state.family });
  const violations = [];
  for (const [wave, call] of state.calls.entries()) {
    if (wave >= rebuilt.offers.length || call.wave !== wave ||
        (call.id !== "pass" && (call.id !== "accept" || !rebuilt.slots))) {
      violations.push("Invalid decision log.");
      break;
    }
    stepSurvey(rebuilt, call.id);
  }
  if (state.wave !== rebuilt.wave || state.done !== rebuilt.done) violations.push("Wave clock mismatch.");
  if (state.slots !== rebuilt.slots || state.loads.length !== rebuilt.loads.length) violations.push("Capacity mismatch.");
  if (state.net !== rebuilt.net) violations.push("Contribution mismatch.");
  if (rebuilt.loads.some((load, i) => ["wave", "lane", "revenue", "cost"].some(key => state.loads[i]?.[key] !== load[key]))) {
    violations.push("Signed load mismatch.");
  }
  return { net: rebuilt.net, accepted: rebuilt.loads.length, usedSlots: rebuilt.loads.length, capacity: 2, waves: state.wave, violations };
}
