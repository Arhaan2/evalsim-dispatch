import { BOOKING_PATTERNS, BOOKING_SUITE, createBooking, observeBooking, reserveCalls, stepBooking } from "./booking.js";
import { createCloses } from "./closes.js";
import { SURVEY_SUITE } from "./survey.js";

export const PAID_VERSION = "paid-v1.0.0";
export const SURVEY_FEE = 1;
export const SURVEY_SAMPLES = 6;

function pair(stem, title, stratum, opening, cold, hot) {
  return [["cold", cold], ["hot", hot]].map(([ending, tail]) => [stem + "-" + ending, Object.freeze({
    stem, stratum, ending, prefixLength: opening.length, levels: Object.freeze([...opening, ...tail]),
    label: title + " · " + ending + " finish", description: "Matched freight through wave " + opening.length + ".",
  })]);
}

const validation = [
  ...pair("after-crest", "After the crest", "reversal", [2,0,4,1,1], [0,1,0], [3,4,4]),
  ...pair("deep-trough", "Deep trough", "interrupted-drop", [2,3,1,1,0], [3,1,0], [0,4,4]),
];
const test = [
  ...pair("staggered-lift", "Staggered lift", "reversal", [2,1,0,3], [0,1,1,0], [1,3,4,4]),
  ...pair("middle-shelf", "Middle shelf", "reversal", [2,1,3,2,2], [3,0,0], [0,4,4]),
  ...pair("double-trough", "Double trough", "interrupted-drop", [2,3,0,0], [2,3,1,0], [0,1,3,4]),
  ...pair("late-slide", "Late slide", "interrupted-drop", [2,3,3,4,1], [0,1,0], [3,4,4]),
];
function split(start, count, families) {
  return Object.freeze({ start, count, families: Object.freeze(families) });
}
export const PAID_SUITE = Object.freeze({ id: "dispatch-paid-v1", splits: Object.freeze({
  train: split(15100000, 60000, BOOKING_SUITE.splits.train.families),
  validation: split(15200000, 128, validation.map(([name]) => name)),
  test: split(15300000, 1024, test.map(([name]) => name)),
  retention: split(15400000, 1024, ["interrupted-drop"]),
  archive: split(15500000, 1024, BOOKING_SUITE.splits.test.families),
  surveyArchive: split(15600000, 1024, SURVEY_SUITE.splits.test.families),
}) });
const inherited = ["train", "retention", "archive", "surveyArchive"].flatMap(splitName =>
  PAID_SUITE.splits[splitName].families.map(name => [name, BOOKING_PATTERNS[name]]));
export const PAID_PATTERNS = Object.freeze(Object.fromEntries([...inherited, ...validation, ...test]));

export function paidCases(splitName = "test") {
  if (!Object.hasOwn(PAID_SUITE.splits, splitName)) throw new RangeError("Unknown paid survey split.");
  const { start, count, families } = PAID_SUITE.splits[splitName];
  return Array.from({ length: count }, (_, i) => families.map(family => ({ split: splitName, seed: start + i, family }))).flat();
}

function drawStream(start) {
  let counter = start >>> 0;
  return () => {
    counter = (counter + 0x6d2b79f5) >>> 0;
    let word = Math.imul(counter ^ (counter >>> 15), counter | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  };
}

function nativeShift(seed, family) {
  const state = createCloses({ seed, family: "flash-crest-cold" });
  const cold = Math.min(...state.trueHighChances), hot = Math.max(...state.trueHighChances);
  state.family = family;
  state.trueHighChances = PAID_PATTERNS[family].levels.map(level => cold + (hot - cold) * level / 4);
  const draw = drawStream(seed + 4 * 0x6d2b79f5);
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

// Six synthetic observations at the wave-six rate. Both twins and all
// policies share these uniforms on a stream separate from the freight tape.
function freshSurvey(state) {
  const draw = drawStream(state.seed ^ 0xa5c379bd);
  let highs = 0;
  for (let i = 0; i < SURVEY_SAMPLES; i++) if (draw() < state.trueHighChances[5]) highs++;
  return highs;
}

export function createPaid({ seed, family = PAID_SUITE.splits.test.families[0], fee = SURVEY_FEE }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(PAID_PATTERNS, family)) throw new RangeError("Unknown paid survey pattern.");
  if (fee !== SURVEY_FEE && fee !== 0) throw new RangeError("Choose the official survey fee or the free control.");
  const state = Object.hasOwn(BOOKING_PATTERNS, family) ? createBooking({ seed, family }) : nativeShift(seed, family);
  return Object.assign(state, { surveyFee: fee, feePaid: 0, surveyAction: null, reading: null });
}

function atGate(state) { return state.wave === 5 && state.surveyAction === null; }

function addSurveyFields(publicFreight, state) {
  const survey = atGate(state);
  return { ...publicFreight, phase: survey ? "survey" : "freight",
    offer: survey ? null : publicFreight.offer, surveyFee: state.surveyFee, feePaid: state.feePaid,
    gross: state.net + state.feePaid, surveyAction: state.surveyAction, reading: state.reading };
}

export function observePaid(state) { return addSurveyFields(observeBooking(state), state); }
export function paidCalls(o) {
  if (o.phase === "survey") return [{ id: "buy", label: "Buy a fresh survey" }, { id: "skip", label: "Skip the survey" }];
  return reserveCalls(o);
}

export function stepPaid(state, action) {
  if (atGate(state)) {
    if (action !== "buy" && action !== "skip") throw new RangeError("Choose buy or skip before wave six.");
    state.surveyAction = action;
    if (action === "buy") {
      state.reading = freshSurvey(state);
      state.feePaid = state.surveyFee;
      state.net -= state.feePaid;
    }
    return observePaid(state);
  }
  return addSurveyFields(stepBooking(state, action), state);
}

// Rebuild prices and survey samples from the sealed fixture. Calls contains
// only the eight freight decisions; the separate survey action occurs at five.
export function verifyPaid(state) {
  const rebuilt = createPaid({ seed: state.seed, family: state.family, fee: state.surveyFee });
  const violations = [];
  const survey = state.surveyAction;
  if ((survey !== null && survey !== "buy" && survey !== "skip") ||
      (state.calls.length < 5 && survey !== null) || (state.calls.length > 5 && survey === null))
    violations.push("Invalid survey decision.");
  for (const [wave, call] of state.calls.entries()) {
    if (wave >= rebuilt.offers.length || call.wave !== wave ||
        (call.id !== "pass" && (call.id !== "accept" || !rebuilt.slots))) {
      violations.push("Invalid freight decision log.");
      break;
    }
    stepBooking(rebuilt, call.id);
  }
  const bought = survey === "buy";
  const feePaid = bought ? rebuilt.surveyFee : 0, reading = bought ? freshSurvey(rebuilt) : null;
  const gross = rebuilt.net, net = gross - feePaid;
  if (state.feePaid !== feePaid || state.reading !== reading) violations.push("Survey ledger mismatch.");
  if (state.done !== rebuilt.done || state.wave !== rebuilt.wave) violations.push("Wave clock mismatch.");
  if (state.net !== net) violations.push("Net contribution mismatch.");
  if (state.slots !== rebuilt.slots || state.loads.length !== rebuilt.loads.length) violations.push("Capacity mismatch.");
  if (rebuilt.loads.some((load,i) => ["wave","lane","revenue","cost"].some(key => state.loads[i]?.[key] !== load[key])))
    violations.push("Signed load mismatch.");
  return { net, gross, feePaid, bought, reading, accepted: rebuilt.loads.length, usedSlots: rebuilt.loads.length,
    capacity: 2, waves: rebuilt.wave, violations };
}
