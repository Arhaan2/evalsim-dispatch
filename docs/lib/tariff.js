import { PAID_SUITE, PAID_PATTERNS, createPaid, observePaid, stepPaid, paidCalls } from "./paid.js";
import { createCloses } from "./closes.js";

export const TARIFF_VERSION = "tariff-v1.0.0";
export const PRICE_CENTS = Object.freeze([0, 5, 10, 25, 50, 75, 100]);
export { paidCalls as tariffCalls };

function twins(stem, title, stratum, opening, cold, hot) {
  return [["cold",cold], ["hot",hot]].map(([ending, tail]) => [stem + "-" + ending, Object.freeze({
    stem, stratum, ending, prefixLength:opening.length, levels:Object.freeze([...opening,...tail]),
    label:title + " · " + ending + " finish", description:"Matched freight through wave " + opening.length + ".",
  })]);
}

// Each test stratum includes one broadly aligned wave-six reading and one
// temporary wave-six move in the direction opposite to its eventual finish.
const validation = [
  ...twins("ridge-return", "Ridge return", "reversal", [2,1,0,1,3], [1,0,0], [3,3,4]),
  ...twins("flat-trough", "Flat trough", "interrupted-drop", [2,4,1,1,1], [3,1,0], [0,3,4]),
];
const test = [
  ...twins("fast-lift", "Fast lift", "reversal", [2,0,1,4], [3,0,1,0], [1,3,3,4]),
  ...twins("recovering-shelf", "Recovering shelf", "reversal", [2,1,1,0,3], [3,1,0], [1,3,4]),
  ...twins("step-rebound", "Step rebound", "interrupted-drop", [2,4,0,2], [3,4,1,0], [2,0,4,4]),
  ...twins("trough-pause", "Trough pause", "interrupted-drop", [2,3,4,1,1], [1,0,0], [3,3,4]),
];

function split(start, count, families) {
  return Object.freeze({ start, count, families:Object.freeze(families) });
}
export const TARIFF_SUITE = Object.freeze({
  id:"dispatch-tariff-v1", priceCents:PRICE_CENTS, splits:Object.freeze({
    train:split(16100000,60000,PAID_SUITE.splits.train.families),
    validation:split(16200000,32,validation.map(([name]) => name)),
    test:split(16300000,512,test.map(([name]) => name)),
    retention:split(16400000,1024,["interrupted-drop"]),
    archive:split(16500000,256,PAID_SUITE.splits.test.families),
  }),
});
const inherited = ["train","retention","archive"].flatMap(name => TARIFF_SUITE.splits[name].families.map(f => [f,PAID_PATTERNS[f]]));
export const TARIFF_PATTERNS = Object.freeze(Object.fromEntries([...inherited,...validation,...test]));

export function* iterateTariffCases(splitName = "test") {
  if (!Object.hasOwn(TARIFF_SUITE.splits,splitName)) throw new RangeError("Unknown survey price split.");
  const {start,count,families} = TARIFF_SUITE.splits[splitName];
  for (let seed = start; seed < start+count; seed++) for (const family of families) for (const priceCents of PRICE_CENTS) {
    yield {split:splitName,seed,family,priceCents};
  }
}

export function tariffCases(splitName = "test") {
  // Training has almost 24 million priced cases. Stream this bank without
  // allocating the full manifest. The four public reports use ordinary arrays.
  const cases = iterateTariffCases(splitName);
  return splitName === "train" ? cases : [...cases];
}

function nativeShift(seed, family) {
  // The archived physical simulator draws support and both endpoints before
  // freight. Apply new demand paths to the same ordered freight/survey draws.
  const state = createCloses({seed,family:"flash-crest-cold"});
  const cold = Math.min(...state.trueHighChances), hot = Math.max(...state.trueHighChances);
  state.family = family;
  state.trueHighChances = TARIFF_PATTERNS[family].levels.map(v => cold + (hot-cold)*v/4);
  let counter = (seed + 4 * 0x6d2b79f5) >>> 0;
  function draw() {
    counter = (counter + 0x6d2b79f5) >>> 0;
    let word = Math.imul(counter ^ (counter >>> 15),counter | 1);
    word ^= word + Math.imul(word ^ (word >>> 7),word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  let bulletin = state.board[0].highChance;
  for (const [wave, q] of state.board.entries()) {
    if (wave === 3 || wave === 6) {
      const noise = (Math.floor(draw()*3)-1)/10;
      bulletin = Math.max(0.1,Math.min(0.9,Math.round((state.trueHighChances[wave-2]+noise)*10)/10));
    }
    q.highChance = bulletin;
    q.mean = q.low + bulletin*(q.high-q.low);
    const offer = state.offers[wave];
    offer.net = draw() < state.trueHighChances[wave] ? q.high : q.low;
    offer.revenue = offer.cost + offer.net;
  }
  return state;
}

export function createTariff({seed, family = TARIFF_SUITE.splits.test.families[0], priceCents = 25}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(TARIFF_PATTERNS,family)) throw new RangeError("Unknown survey price market.");
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100) throw new RangeError("Use a whole-cent price from 0 to 100.");
  const state = Object.hasOwn(PAID_PATTERNS,family) ? createPaid({seed,family,fee:0}) : nativeShift(seed,family);
  return Object.assign(state,{ priceCents, surveyFee:priceCents/100, surveyAction:null, reading:null,
    grossCents:0, feeCents:0, netCents:0, feePaid:0 });
}

function withLedger(o, s) {
  return {...o, priceCents:s.priceCents, grossCents:s.grossCents, netCents:s.netCents, feeCents:s.feeCents,
    gross:s.grossCents/100, net:s.netCents/100, feePaid:s.feeCents/100};
}
export function observeTariff(state) {
  return withLedger(observePaid(state),state);
}
export function stepTariff(s, action) {
  const offerCents = action === "accept" ? (s.offers[s.wave]?.net ?? 0)*100 : 0;
  const next = stepPaid(s,action);
  s.grossCents += offerCents;
  s.feeCents = s.surveyAction === "buy" ? s.priceCents : 0;
  s.netCents = s.grossCents-s.feeCents;
  s.net = s.netCents/100;
  return withLedger(next,s);
}

// Replay every signed load against the sealed market and independently
// reconstruct the fee and sample. A zero-cost purchase is still a purchase.
export function verifyTariff(s) {
  const rebuilt = createTariff({family:s.family,seed:s.seed,priceCents:s.priceCents});
  const violations = [];
  const chosen = s.surveyAction;
  const atGate = () => rebuilt.wave === 5 && rebuilt.surveyAction === null;
  if (![null,"buy","skip"].includes(chosen) || (s.calls.length < 5 && chosen !== null) ||
      (s.calls.length > 5 && chosen === null)) violations.push("Invalid survey decision.");
  for (const [wave,call] of s.calls.entries()) {
    if (atGate() && (chosen === "skip" || chosen === "buy")) stepTariff(rebuilt,chosen);
    if (rebuilt.done || atGate() || call.wave !== wave ||
        (call.id !== "pass" && (call.id !== "accept" || !rebuilt.slots))) {
      violations.push("Invalid freight decision log.");
      break;
    }
    stepTariff(rebuilt,call.id);
  }
  if (atGate() && (chosen === "skip" || chosen === "buy")) stepTariff(rebuilt,chosen);
  if (s.feeCents !== rebuilt.feeCents || s.surveyFee !== rebuilt.surveyFee || s.feePaid !== rebuilt.feePaid ||
      s.reading !== rebuilt.reading) violations.push("Survey charge or reading mismatch.");
  if (s.grossCents !== rebuilt.grossCents || s.netCents !== rebuilt.netCents || s.net !== rebuilt.net)
    violations.push("Net contribution mismatch.");
  if (s.wave !== rebuilt.wave || s.done !== rebuilt.done) violations.push("Wave clock mismatch.");
  if (s.slots !== rebuilt.slots || s.loads.length !== rebuilt.loads.length) violations.push("Capacity mismatch.");
  if (rebuilt.loads.some((load,i) => ["wave","lane","revenue","cost"].some(key => s.loads[i]?.[key] !== load[key])))
    violations.push("Signed load mismatch.");
  return { netCents:rebuilt.netCents, grossCents:rebuilt.grossCents, feeCents:rebuilt.feeCents,
    net:rebuilt.netCents/100, gross:rebuilt.grossCents/100, feePaid:rebuilt.feeCents/100,
    bought:rebuilt.surveyAction === "buy", reading:rebuilt.reading, accepted:rebuilt.loads.length,
    usedSlots:rebuilt.loads.length, capacity:2, waves:rebuilt.wave, violations };
}
