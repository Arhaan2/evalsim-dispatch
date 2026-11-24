import { PRICE_CENTS, TARIFF_PATTERNS, TARIFF_SUITE, createTariff, observeTariff, stepTariff,
  tariffCalls, verifyTariff } from "./tariff.js";

export { PRICE_CENTS, observeTariff as observeLastslot, stepTariff as stepLastslot, tariffCalls as lastslotCalls };
export const LASTSLOT_VERSION = "lastslot-v1.0.0";

function twins(stem, title, stratum, opening, cold, hot) {
  return [["cold", cold], ["hot", hot]].map(([ending, tail]) => [stem + "-" + ending, Object.freeze({
    stem, stratum, ending, prefixLength: opening.length, levels: Object.freeze([...opening, ...tail]),
    label: title + " · " + ending + " finish", description: "Matched freight through wave five.",
  })]);
}

// Seed 171 draws pairs using demand levels only. Both endings share the
// entire five-offer history at purchase; half the readings in each fresh
// stratum sample a wave-six market moving opposite to the eventual close.
const validation = [
  ...twins("quick-crest", "Quick crest", "reversal", [2,1,1,4,0], [0,1,0], [3,4,4]),
  ...twins("broken-shelf", "Broken shelf", "interrupted-drop", [2,3,1,3,3], [4,0,0], [1,3,4]),
];
const fresh = [
  ...twins("single-spike", "Single spike", "reversal", [2,1,4,0,0], [0,1,0], [4,4,4]),
  ...twins("slow-climb", "Slow climb", "reversal", [2,0,1,2,3], [3,0,0], [0,4,4]),
  ...twins("low-plateau", "Low plateau", "reversal", [2,0,0,2,4], [0,1,0], [4,4,4]),
  ...twins("steady-rally", "Steady rally", "reversal", [2,1,0,3,3], [4,0,0], [1,3,4]),
  ...twins("cliff-drop", "Cliff drop", "interrupted-drop", [2,3,4,0,0], [3,0,0], [1,4,4]),
  ...twins("late-bounce", "Late bounce", "interrupted-drop", [2,4,0,2,4], [1,0,0], [4,3,4]),
  ...twins("high-ledge", "High ledge", "interrupted-drop", [2,4,4,4,1], [4,0,0], [1,4,4]),
  ...twins("long-trough", "Long trough", "interrupted-drop", [2,4,1,0,0], [0,0,0], [3,4,4]),
];

function split(start,count,families) {
  return Object.freeze({ start, count, families:Object.freeze(families) });
}
export const LASTSLOT_SUITE = Object.freeze({
  id:"dispatch-lastslot-v1", priceCents:PRICE_CENTS, splits:Object.freeze({
    train:split(17100000,60000,TARIFF_SUITE.splits.train.families),
    validation:split(17200000,32,validation.map(([key])=>key)),
    test:split(17300000,1024,fresh.map(([key])=>key)),
    retention:split(17400000,1024,["interrupted-drop"]),
    archive:split(17500000,128,TARIFF_SUITE.splits.test.families),
  }),
});
const inherited = ["train","retention","archive"].flatMap(splitName =>
  LASTSLOT_SUITE.splits[splitName].families.map(key=>[key,TARIFF_PATTERNS[key]]));
export const LASTSLOT_PATTERNS = Object.freeze(Object.fromEntries([...inherited,...validation,...fresh]));

function* manifest(splitName) {
  const {start,count,families} = LASTSLOT_SUITE.splits[splitName];
  for (let seed=start;seed<start+count;seed++) for (const family of families) for (const priceCents of PRICE_CENTS) {
    yield {split:splitName,seed,family,priceCents};
  }
}
export function lastslotCases(splitName="test") {
  if (!Object.hasOwn(LASTSLOT_SUITE.splits,splitName)) throw new RangeError("Unknown last-slot split.");
  return splitName === "train" ? manifest(splitName) : [...manifest(splitName)];
}

export function createLastslot({seed,family=LASTSLOT_SUITE.splits.test.families[0],priceCents=25}) {
  if (!Object.hasOwn(LASTSLOT_PATTERNS,family)) throw new RangeError("Unknown last-slot market.");
  if (Object.hasOwn(TARIFF_PATTERNS,family)) return createTariff({seed,family,priceCents});

  // This base schedule visits both demand endpoints. Reuse its exact public
  // support, initial bulletin and cent ledger; replay freight at the new rates.
  const state = createTariff({seed,priceCents,family:"staggered-lift-hot"});
  const cold = Math.min(...state.trueHighChances), hot = Math.max(...state.trueHighChances);
  state.family = family;
  state.trueHighChances = LASTSLOT_PATTERNS[family].levels.map(v=>cold+(hot-cold)*v/4);
  let counter = (seed + 4*0x6d2b79f5) >>> 0;
  function draw() {
    counter = (counter + 0x6d2b79f5) >>> 0;
    let word = Math.imul(counter ^ (counter >>> 15),counter | 1);
    word ^= word + Math.imul(word ^ (word >>> 7),word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  let bulletin = state.board[0].highChance;
  for (const [wave,quote] of state.board.entries()) {
    if (wave === 3 || wave === 6) {
      const noise = (Math.floor(draw()*3)-1)/10;
      bulletin = Math.max(0.1,Math.min(0.9,Math.round((state.trueHighChances[wave-2]+noise)*10)/10));
    }
    quote.highChance = bulletin;
    quote.mean = quote.low+bulletin*(quote.high-quote.low);
    const offer = state.offers[wave];
    offer.net = draw() < state.trueHighChances[wave] ? quote.high : quote.low;
    offer.revenue = offer.cost+offer.net;
  }
  return state;
}

export function verifyLastslot(s) {
  if (Object.hasOwn(TARIFF_PATTERNS,s.family)) return verifyTariff(s);
  const rebuilt=createLastslot({seed:s.seed,family:s.family,priceCents:s.priceCents});
  const violations=[], chosen=s.surveyAction;
  if (![null,"buy","skip"].includes(chosen) || (s.calls.length<5 && chosen!==null) ||
      (s.calls.length>5 && chosen===null)) violations.push("Invalid survey decision.");
  for (const [wave,call] of s.calls.entries()) {
    if (rebuilt.done || call.wave!==wave ||
        (call.id!=="pass" && (call.id!=="accept" || rebuilt.slots===0)) ||
        (wave===5 && rebuilt.surveyAction===null)) {
      violations.push("Invalid freight decision log.");
      break;
    }
    stepTariff(rebuilt,call.id);
    if (rebuilt.wave===5 && (chosen==="buy" || chosen==="skip")) stepTariff(rebuilt,chosen);
  }
  if (["reading","surveyFee","feePaid","feeCents","net","netCents","grossCents","wave","done","slots"]
      .some(k=>s[k]!==rebuilt[k])) violations.push("Survey or freight ledger mismatch.");
  if (s.loads.length!==rebuilt.loads.length || rebuilt.loads.some((load,i)=>
    ["wave","lane","revenue","cost"].some(key=>s.loads[i]?.[key]!==load[key]))) violations.push("Signed load mismatch.");
  const {netCents,grossCents,feeCents,reading} = rebuilt;
  return {netCents,grossCents,feeCents,net:netCents/100,gross:grossCents/100,feePaid:feeCents/100,
    bought:rebuilt.surveyAction==="buy",reading,accepted:rebuilt.loads.length,usedSlots:rebuilt.loads.length,
    capacity:2,waves:rebuilt.wave,violations};
}
