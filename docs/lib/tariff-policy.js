import { compilePlanner, marketPrior, paidDecision, paidEvidence, paidRow, returnKeys, trainingMarkets } from "./paid-policy.js";
import { PRICE_CENTS, TARIFF_PATTERNS, TARIFF_SUITE } from "./tariff.js";

// Keep the published hierarchy as a fallback and retain the full public high/low
// history and second bulletin in the most specific fitted cell.
const exactKey = e => "exact:" + [e.low,e.high,e.bits,e.first,e.second,e.reading].join("/");
export const tariffKeys = e => [...returnKeys(e),exactKey(e)];
export const tariffRow = (table,e) => table[exactKey(e)] ?? paidRow(table,e);
function purchase(o,mode,row) {
  const buyValue = row[o.slots+1] - o.surveyFee, skipValue = row[o.slots-1];
  const advantage = buyValue - skipValue;
  return { action:mode === "always" || (mode !== "never" && advantage>1e-10) ? "buy" : "skip",
    buyValue,skipValue,advantage,bookValue:null,waitValue:null };
}

function freight(o, future) {
  const bookValue = o.offer.net + (o.slots === 2 ? future[0] : 0);
  const waitValue = future[o.slots - 1];
  return { action: bookValue >= waitValue - 1e-10 ? "accept" : "pass",
    bookValue, waitValue, advantage:bookValue-waitValue, buyValue:null, skipValue:null };
}

export function tariffDecision(o, model, mode = "optional") {
  // Survey returns are gross until the gate, where the known fee is charged.
  // Once a reading is bought the price is sunk and the same freight heads apply.
  if (o.done || o.wave === 7 || !o.slots) return paidDecision(o,null,mode);
  const e = paidEvidence(o);
  if (e.gate) return purchase(o,mode,tariffRow(model.gate,e));
  if (o.wave >= 5) return freight(o,tariffRow(model.tail[o.wave-5],e));
  const high = PRICE_CENTS.find(c => c >= o.priceCents);
  if (high === undefined || o.priceCents < 0 || !Number.isInteger(o.priceCents)) throw new RangeError("Invalid survey price.");
  const upper = tariffRow(model.early[high][o.wave], e);
  if (high === o.priceCents) return freight(o, upper);
  const low = PRICE_CENTS[PRICE_CENTS.indexOf(high)-1];
  const lower = tariffRow(model.early[low][o.wave], e);
  const weight = (o.priceCents-low)/(high-low);
  return freight(o, lower.map((value,j) => value + weight*(upper[j]-value)));
}

export const chooseTariff = (o,model,mode) => tariffDecision(o,model,mode).action;

const keyFor = (bits,first,second,reading) => bits + (first<<8) + (second<<12) + ((reading+1)<<16);

// The seven survey outcomes and the last three freight decisions are identical
// at every tariff once the price is sunk. Compile that tree once per price board.
// Only the first five stages need a new backwards pass when the tariff changes.
export function repriceOpening(supports, prior, gate, fee) {
  const stages = Array.from({length:5}, () => new Map());
  const size = prior.size;
  function prices(w, weights, bits, first) {
    const values = [0,0];
    for (const bit of [0,1]) {
      const signed = bits + (bit<<w);
      const next = new Float64Array(size);
      let mass = 0;
      for (let j=0;j<size;j++) {
        next[j] = weights[j]*(bit ? prior.rates[w][j] : 1-prior.rates[w][j]);
        mass += next[j];
      }
      let future;
      if (w === 4) {
        const row = gate.get(keyFor(signed,first,0,-1));
        future = [Math.max(row[0],row[2]-fee)*mass,Math.max(row[1],row[3]-fee)*mass];
      } else if (w === 2) {
        future = [0,0];
        for (let b=1;b<=9;b++) {
          const conditioned = next.map((v,j) => v*prior.bulletins[0][b][j]);
          const branch = prices(w+1,conditioned,signed,b);
          future[0] += branch[0]; future[1] += branch[1];
        }
      } else future = prices(w+1,next,signed,first);
      stages[w].set(keyFor(signed,first,0,-1),future.map(v=>v/mass));
      const freight = mass*supports[w][bit];
      values[0] += Math.max(future[0],freight);
      values[1] += Math.max(future[1],freight+future[0]);
    }
    return values;
  }
  prices(0,new Float64Array(size).fill(1/size),0,0);
  return stages;
}

let prior;
const boards = new Map();
function plannerBoard(o) {
  const supports = [...o.history.map(h=>h.quote),o.quote,...o.forecast].map(q=>[q.low,q.high]);
  const id = supports.join("|");
  let board = boards.get(id);
  if (!board) {
    prior ??= marketPrior(trainingMarkets(TARIFF_SUITE.splits.train.families,TARIFF_PATTERNS)
      .fit.map(({family})=>TARIFF_PATTERNS[family].levels));
    const {gate,stages} = compilePlanner(supports,prior,0);
    board = {supports,gate,tail:stages.slice(5),early:new Map([[0,stages.slice(0,5)]])};
    // The simulator uses two price boards. A custom caller cannot grow this cache.
    if (boards.size === 2) boards.delete(boards.keys().next().value);
    boards.set(id,board);
  }
  return board;
}

export function tariffPlannerDecision(o, _model, mode = "optional") {
  if (o.done || !o.slots || o.wave === 7) return paidDecision(o,null,mode);
  const cents = o.priceCents;
  if (!Number.isInteger(cents) || cents<0 || cents>100) throw new RangeError("Invalid survey price.");
  const e = paidEvidence(o), board = plannerBoard(o);
  const id = keyFor(e.bits,e.first,e.second,e.reading);
  if (e.gate) return purchase(o,mode,board.gate.get(id));
  if (o.wave >= 5) return freight(o,board.tail[o.wave-5].get(id));
  if (!board.early.has(cents)) board.early.set(cents,repriceOpening(board.supports,prior,board.gate,cents/100));
  return freight(o,board.early.get(cents)[o.wave].get(id));
}

export const chooseTariffPlanner = (o,model,mode) => tariffPlannerDecision(o,model,mode).action;
