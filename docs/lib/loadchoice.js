import { PRICE_CENTS, LASTSLOT_PATTERNS, LASTSLOT_SUITE, createLastslot, observeLastslot,
  stepLastslot, lastslotCalls, verifyLastslot } from "./lastslot.js";

export { PRICE_CENTS, observeLastslot as observeLoadchoice, stepLastslot as stepLoadchoice, lastslotCalls as loadchoiceCalls };
export const LOADCHOICE_VERSION = "loadchoice-v1.0.0";

// Each row is the shared five-wave opening, the cold three-wave close and
// the hot three-wave close. Digits 0–4 interpolate the seed’s demand rates.
function twins(stem, title, stratum, schedule) {
  const [opening,cold,hot] = schedule.split(" ");
  return [["cold",cold],["hot",hot]].map(([ending,tail])=>[stem+"-"+ending,Object.freeze({
    stem,stratum,ending,prefixLength:5,levels:Object.freeze(Array.from(opening+tail,Number)),
    label:title+" · "+ending+" finish",description:"Matched freight through wave five.",
  })]);
}

function practiceTwins(stratum, rows) {
  return rows.flatMap((schedule,i)=>twins("practice-"+stratum+"-"+(i+1),
    "Practice "+stratum+" "+(i+1),stratum,schedule));
}

// Draw training analogues first. Rotating alignment within each group of
// four balances the family holdout as well as the freight-fitting set.
const practice = [
  ...practiceTwins("reversal", [
    "21341 100 444", "21040 400 044", "21303 000 334", "21203 400 144",
    "20304 300 144", "20340 110 434", "21411 300 144", "20303 100 334",
    "20330 100 434", "21434 410 134", "21133 100 444", "20404 300 044",
    "20013 400 044", "20310 110 434", "21034 300 134", "20331 010 434",
  ]),
  ...practiceTwins("interrupted-drop", [
    "23214 410 134", "23311 000 434", "23003 410 134", "23024 010 344",
    "24020 110 344", "23310 400 044", "24302 110 444", "23031 410 044",
    "23132 300 134", "23320 100 334", "24120 300 044", "24301 110 434",
    "24240 100 334", "24300 300 044", "24231 100 444", "23231 310 034",
  ]),
];

// Seed 181 reserves unseen openings and movement signatures after the training
// draw. Selection reads only the sequences of demand levels.
const validation = [
  ...twins("rally-shelf", "Rally shelf", "reversal", "21443 000 344"),
  ...twins("crest-fall", "Crest fall", "interrupted-drop", "23441 400 034"),
];
const fresh = [
  ...twins("hollow-lift", "Hollow lift", "reversal", "21003 110 434"),
  ...twins("gradual-rally", "Gradual rally", "reversal", "20234 410 134"),
  ...twins("late-crest", "Late crest", "reversal", "21044 110 334"),
  ...twins("short-lived-crest", "Short-lived crest", "reversal", "21141 310 134"),
  ...twins("abrupt-fall", "Abrupt fall", "interrupted-drop", "23340 310 134"),
  ...twins("sinking-shelf", "Sinking shelf", "interrupted-drop", "24110 010 444"),
  ...twins("brief-trough", "Brief trough", "interrupted-drop", "24001 300 134"),
  ...twins("return-bounce", "Return bounce", "interrupted-drop", "23303 010 344"),
];

function split(start,count,families) {
  return Object.freeze({ start, count, families:Object.freeze(families) });
}
export const LOADCHOICE_SUITE = Object.freeze({
  id:"dispatch-loadchoice-v1", priceCents:PRICE_CENTS, splits:Object.freeze({
    train:split(18100000,60000,[...LASTSLOT_SUITE.splits.train.families,...practice.map(([key])=>key)]),
    validation:split(18200000,32,validation.map(([key])=>key)),
    test:split(18300000,1024,fresh.map(([key])=>key)),
    retention:split(18400000,1024,["interrupted-drop"]),
    archive:split(18500000,128,LASTSLOT_SUITE.splits.test.families),
  }),
});
const inherited = [
  ...LASTSLOT_SUITE.splits.train.families, "interrupted-drop", ...LASTSLOT_SUITE.splits.test.families,
].map(key=>[key,LASTSLOT_PATTERNS[key]]);
export const LOADCHOICE_PATTERNS = Object.freeze(Object.fromEntries([...inherited,...practice,...validation,...fresh]));

function* manifest(splitName) {
  const {start,count,families} = LOADCHOICE_SUITE.splits[splitName];
  for (let seed=start;seed<start+count;seed++) for (const family of families) for (const priceCents of PRICE_CENTS) {
    yield {split:splitName,seed,family,priceCents};
  }
}
export function loadchoiceCases(splitName="test") {
  if (!Object.hasOwn(LOADCHOICE_SUITE.splits,splitName)) throw new RangeError("Unknown load-choice split.");
  return splitName === "train" ? manifest(splitName) : [...manifest(splitName)];
}

export function createLoadchoice({seed,family=LOADCHOICE_SUITE.splits.test.families[0],priceCents=25}) {
  if (!Object.hasOwn(LOADCHOICE_PATTERNS,family)) throw new RangeError("Unknown load-choice market.");
  if (Object.hasOwn(LASTSLOT_PATTERNS,family)) return createLastslot({seed,family,priceCents});

  // This base schedule visits both demand endpoints. Reuse its exact public
  // support, initial bulletin and cent ledger; replay freight at the new rates.
  const state = createLastslot({seed,priceCents,family:"interrupted-drop"});
  const cold = Math.min(...state.trueHighChances), hot = Math.max(...state.trueHighChances);
  state.family = family;
  state.trueHighChances = LOADCHOICE_PATTERNS[family].levels.map(v=>cold+(hot-cold)*v/4);
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

export function verifyLoadchoice(s) {
  if (Object.hasOwn(LASTSLOT_PATTERNS,s.family)) return verifyLastslot(s);
  const rebuilt=createLoadchoice({seed:s.seed,family:s.family,priceCents:s.priceCents});
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
    stepLastslot(rebuilt,call.id);
    if (rebuilt.wave===5 && (chosen==="buy" || chosen==="skip")) stepLastslot(rebuilt,chosen);
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
