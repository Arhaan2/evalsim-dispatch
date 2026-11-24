import { PRICE_CENTS, LOADCHOICE_PATTERNS, LOADCHOICE_SUITE, createLoadchoice, observeLoadchoice,
  stepLoadchoice, loadchoiceCalls, verifyLoadchoice } from "./loadchoice.js";

export { PRICE_CENTS, observeLoadchoice as observeWaitcost, stepLoadchoice as stepWaitcost, loadchoiceCalls as waitcostCalls };
export const WAITCOST_VERSION = "waitcost-v1.0.0";

// Each row is the shared five-wave opening, the cold three-wave close and
// the hot three-wave close. Digits 0–4 interpolate the seed’s demand rates.
function twins(stem, title, stratum, schedule) {
  const [opening,cold,hot] = schedule.split(" ");
  return [["cold",cold],["hot",hot]].map(([ending,tail])=>[stem+"-"+ending,Object.freeze({
    stem,stratum,ending,prefixLength:5,levels:Object.freeze(Array.from(opening+tail,Number)),
    label:title+" · "+ending+" finish",description:"Matched freight through wave five.",
  })]);
}

// A structural draw with seed 191 excludes the existing opening and
// movement signatures before any policy is evaluated. Both endings in a pair
// present identical public freight through the survey purchase window.
const validation = [
  ...twins("slow-pickup", "Slow pickup", "reversal", "21113 110 334"),
  ...twins("shelf-break", "Shelf break", "interrupted-drop", "23440 410 134"),
];
const fresh = [
  ...twins("staircase-rally", "Staircase rally", "reversal", "20223 010 334"),
  ...twins("late-lift", "Late lift", "reversal", "21144 410 134"),
  ...twins("recovery-shelf", "Recovery shelf", "reversal", "20133 010 434"),
  ...twins("brief-peak", "Brief peak", "reversal", "20433 300 034"),
  ...twins("broken-crest", "Broken crest", "interrupted-drop", "23401 410 134"),
  ...twins("steep-ledge", "Steep ledge", "interrupted-drop", "24411 110 334"),
  ...twins("sharp-bounce", "Sharp bounce", "interrupted-drop", "23304 410 034"),
  ...twins("fading-shelf", "Fading shelf", "interrupted-drop", "24431 100 434"),
];

function split(start,count,families) {
  return Object.freeze({ start, count, families:Object.freeze(families) });
}
export const WAITCOST_SUITE = Object.freeze({
  id:"dispatch-waitcost-v1", priceCents:PRICE_CENTS, splits:Object.freeze({
    train:split(19100000,60000,LOADCHOICE_SUITE.splits.train.families),
    validation:split(19200000,32,validation.map(([key])=>key)),
    test:split(19300000,1024,fresh.map(([key])=>key)),
    retention:split(19400000,1024,["interrupted-drop"]),
    archive:split(19500000,128,LOADCHOICE_SUITE.splits.test.families),
  }),
});
const inherited = [
  ...LOADCHOICE_SUITE.splits.train.families, "interrupted-drop", ...LOADCHOICE_SUITE.splits.test.families,
].map(key=>[key,LOADCHOICE_PATTERNS[key]]);
export const WAITCOST_PATTERNS = Object.freeze(Object.fromEntries([...inherited,...validation,...fresh]));

function* manifest(splitName) {
  const {start,count,families} = WAITCOST_SUITE.splits[splitName];
  for (let seed=start;seed<start+count;seed++) for (const family of families) for (const priceCents of PRICE_CENTS) {
    yield {split:splitName,seed,family,priceCents};
  }
}
export function waitcostCases(splitName="test") {
  if (!Object.hasOwn(WAITCOST_SUITE.splits,splitName)) throw new RangeError("Unknown wait-cost split.");
  return splitName === "train" ? manifest(splitName) : [...manifest(splitName)];
}

export function createWaitcost({seed,family=WAITCOST_SUITE.splits.test.families[0],priceCents=25}) {
  if (!Object.hasOwn(WAITCOST_PATTERNS,family)) throw new RangeError("Unknown wait-cost market.");
  if (Object.hasOwn(LOADCHOICE_PATTERNS,family)) return createLoadchoice({seed,family,priceCents});

  // This base schedule visits both demand endpoints. Reuse its exact public
  // support, initial bulletin and cent ledger; replay freight at the new rates.
  const state = createLoadchoice({seed,priceCents,family:"interrupted-drop"});
  const cold = Math.min(...state.trueHighChances), hot = Math.max(...state.trueHighChances);
  state.family = family;
  state.trueHighChances = WAITCOST_PATTERNS[family].levels.map(v=>cold+(hot-cold)*v/4);
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

export function verifyWaitcost(s) {
  if (Object.hasOwn(LOADCHOICE_PATTERNS,s.family)) return verifyLoadchoice(s);
  const rebuilt=createWaitcost({seed:s.seed,family:s.family,priceCents:s.priceCents});
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
    stepLoadchoice(rebuilt,call.id);
    if (rebuilt.wave===5 && (chosen==="buy" || chosen==="skip")) stepLoadchoice(rebuilt,chosen);
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
