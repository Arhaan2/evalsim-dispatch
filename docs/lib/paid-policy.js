// All keys come from the public desk. A paid reading is an integer count,
// including zero. The eighth and final freight offer can always be booked.
import { PAID_PATTERNS, PAID_SUITE } from "./paid.js";

export const POLICY_SPEC = Object.freeze({ shrinkage: 48, diffuseBulletin: 0.01 });

export function trainingMarkets(families, patterns) {
  const fit = [], selection = [], stems = new Map();
  let recovery = 0;
  for (const family of families) {
    const p = patterns[family];
    if (!families.includes(p.stem + "-hot") || !families.includes(p.stem + "-cold")) {
      (++recovery % 3 === 0 ? selection : fit).push({ family, group: 2 });
      continue;
    }
    if (!stems.has(p.stratum)) stems.set(p.stratum, []);
    const list = stems.get(p.stratum);
    if (!list.includes(p.stem)) list.push(p.stem);
    const group = p.stratum === "interrupted-drop" && p.ending === "hot" ? 0 :
      p.stratum === "reversal" && p.ending === "cold" ? 1 : 3;
    ((list.indexOf(p.stem) + 1) % 4 === 0 ? selection : fit).push({ family, group });
  }
  return { fit, selection };
}

export function paidEvidence(o) {
  let bits = 0;
  for (const row of o.history) if (row.high) bits |= 1 << row.wave;
  if (o.offer && o.offer.net === o.quote.high) bits |= 1 << o.wave;
  const bulletin = wave => Math.round(10 * (o.wave === wave ? o.quote : o.history[wave].quote).highChance);
  return { wave:o.wave, gate:o.phase === "survey", low:o.quote.low, high:o.quote.high, bits,
    first:o.wave >= 3 ? bulletin(3) : 0, second:o.wave >= 6 ? bulletin(6) : 0, reading:o.reading ?? -1 };
}

const band = b => b <= 3 ? 0 : b >= 7 ? 2 : 1;
export function returnKeys(e) {
  const parts = [e.low, e.high];
  if (e.wave >= 5 && !e.gate) parts.push(e.reading < 0 ? "blind" : "sample-" + (e.reading <= 1 ? 0 : e.reading >= 5 ? 2 : 1));
  if (e.wave >= 3) parts.push(band(e.first));
  if (!e.gate) parts.push((e.bits >> e.wave) & 1);
  if (e.wave >= 6) parts.push(band(e.second));
  if (e.wave >= 5 && !e.gate) parts.push(e.reading);
  if (e.wave >= 1) parts.push((e.bits >> 1) & 1);
  if (e.wave >= 2) parts.push((e.bits >> 2) & 1);
  if (e.wave >= 3) parts.push(e.first);
  if (e.wave >= 4) parts.push((e.bits >> (e.wave - 1)) & 1);
  const path = ["*"];
  // The quoted supports travel together and define one price schedule.
  let key = parts[0] + "/" + parts[1];
  path.push(key);
  for (const part of parts.slice(2)) { key += "|" + part; path.push(key); }
  return path;
}

export function paidRow(table, e) {
  const path = returnKeys(e);
  for (let i=path.length-1; i>=0; i--) if (Object.hasOwn(table,path[i])) return table[path[i]];
  throw new Error("Missing paid-survey return estimates.");
}

function surveyChoice(o, mode, grossBuy, skip) {
  const buy = grossBuy - o.surveyFee, advantage = buy - skip;
  const take = mode === "always" || (mode !== "never" && o.slots && advantage > 1e-10);
  return { action:take ? "buy" : "skip", buyValue:buy, skipValue:skip, advantage,
    bookValue:null, waitValue:null };
}
function freightChoice(book, wait, canBook) {
  return { action:canBook && book >= wait - 1e-10 ? "accept" : "pass",
    bookValue:canBook ? book : null, waitValue:wait, advantage:canBook ? book-wait : null, buyValue:null, skipValue:null };
}
function terminal(o) {
  if (o.done) return { action:null, bookValue:null, waitValue:null, buyValue:null, skipValue:null, advantage:null };
  if (o.phase === "survey" || (o.slots && o.wave < 7)) return null;
  return freightChoice(o.offer.net,0,Boolean(o.slots));
}
export function paidDecision(o, model, mode="optional") {
  const terminalDecision = terminal(o);
  if (terminalDecision) return terminalDecision;
  if (!o.slots) return surveyChoice(o,mode,0,0);
  const e = paidEvidence(o);
  if (e.gate) {
    const row = paidRow(model.gate,e);
    return surveyChoice(o,mode,row[2 + o.slots-1],row[o.slots-1]);
  }
  const future = paidRow(model.stages[o.wave],e);
  return freightChoice(o.offer.net + (o.slots === 1 ? 0 : future[0]), future[o.slots-1], true);
}
export const choosePaid = (o,model,mode) => paidDecision(o,model,mode).action;

// Distribution-aware references enumerate only the equally likely fitting
// schedules and the four independent cold/hot endpoint combinations. Their
// prior never includes validation, selection, original or test schedules.
const sampleCoefficients = [1,6,15,20,15,6,1];
export function marketPrior(paths) {
  const h = paths.length * 4;
  const rates = Array.from({ length:8 }, () => new Float64Array(h));
  const samples = Array.from({ length:7 }, () => new Float64Array(h));
  const bulletins = [0,1].map(() => Array.from({ length:10 }, () => new Float64Array(h)));
  let j = 0;
  for (const levels of paths) for (const cold of [0.1,0.2]) for (const hot of [0.75,0.85]) {
    for (let w=0; w<8; w++) rates[w][j] = cold + (hot-cold)*levels[w]/4;
    for (const [i,t] of [1,4].entries()) {
      for (let b=1; b<=9; b++) bulletins[i][b][j] = POLICY_SPEC.diffuseBulletin/9;
      for (const noise of [-0.1,0,0.1]) {
        const b = Math.max(1,Math.min(9,Math.round(10*(rates[t][j]+noise))));
        bulletins[i][b][j] += (1-POLICY_SPEC.diffuseBulletin)/3;
      }
    }
    const p = rates[5][j];
    for (let k=0; k<=6; k++) samples[k][j] = sampleCoefficients[k]*p**k*(1-p)**(6-k);
    j++;
  }
  return { rates, samples, bulletins, size:h };
}
const stateId = (bits,b1,b2,r) => bits + (b1<<8) + (b2<<12) + ((r+1)<<16);
const product = (a,b) => Float64Array.from(a, (x,j) => x*b[j]);
const sum = a => a.reduce((s,x) => s+x,0);
const add = (a,b) => [a[0]+b[0],a[1]+b[1]];

// Rows store unconditioned continuation means for freight, or expected gross
// returns of skip and buy before the reading. Carry unnormalized belief mass
// through the tree so each branch has its correct ex-ante probability.
export function compilePlanner(supports, prior, fee) {
  const stages = Array.from({length:7}, () => new Map()), gate = new Map();
  const { rates, samples, bulletins, size } = prior;
  function lastPair(weights,bits,b1,r) {
    const values = [0,0], [lastLow,lastHigh] = supports[7];
    const [low,high] = supports[6];
    // At wave seven only one further offer remains. Integrate its first
    // moment jointly with the two wave-seven observations, without expanding
    // another tree level or ever observing the eighth price in advance.
    for (let b2=1; b2<=9; b2++) {
      let lowMass=0, highMass=0, lowNext=0, highNext=0;
      const chances = bulletins[1][b2];
      for (let j=0; j<size; j++) {
        const w=weights[j]*chances[j], hi=w*rates[6][j], lo=w-hi;
        lowMass+=lo; highMass+=hi; lowNext+=lo*rates[7][j]; highNext+=hi*rates[7][j];
      }
      for (const [bit,price,mass,p] of [[0,low,lowMass,lowNext],[1,high,highMass,highNext]]) {
        if (!mass) continue;
        const finalPrice=lastLow+(lastHigh-lastLow)*p/mass;
        stages[6].set(stateId(bits+(bit<<6),b1,b2,r), [finalPrice,finalPrice]);
        values[0]+=mass*Math.max(price,finalPrice);
        values[1]+=mass*(price+finalPrice);
      }
    }
    return values;
  }
  function purchase(weights,bits,b1) {
    const mass=sum(weights);
    const skip=prices(5,weights,bits,b1,-1);
    let buy=[0,0];
    for (let r=0; r<=6; r++) buy=add(buy,prices(5,product(weights,samples[r]),bits,b1,r));
    gate.set(stateId(bits,b1,0,-1),[skip[0]/mass,skip[1]/mass,buy[0]/mass,buy[1]/mass]);
    return skip.map((v,i)=>Math.max(v,buy[i]-fee*mass));
  }
  function prices(t,weights,bits,b1,r) {
    let values=[0,0];
    for (let bit=0; bit<=1; bit++) {
      const newBits=bits+(bit<<t), next=new Float64Array(size);
      for (let j=0; j<size; j++) next[j]=weights[j]*(bit ? rates[t][j] : 1-rates[t][j]);
      const mass=sum(next), price=supports[t][bit];
      let cont;
      if (t===5) cont=lastPair(next,newBits,b1,r);
      else if (t===4) cont=purchase(next,newBits,b1);
      else if (t===2) {
        cont=[0,0];
        for (let b=1; b<=9; b++) cont=add(cont,prices(3,product(next,bulletins[0][b]),newBits,b,-1));
      } else cont=prices(t+1,next,newBits,b1,r);
      stages[t].set(stateId(newBits,b1,0,r),cont.map(v=>v/mass));
      values=add(values,[Math.max(cont[0],mass*price),Math.max(cont[1],mass*price+cont[0])]);
    }
    return values;
  }
  prices(0,new Float64Array(size).fill(1/size),0,0,-1);
  return {stages,gate};
}
let prior;
const plannerTables = new Map();
export function paidPlannerDecision(o, _model, mode="optional") {
  const done=terminal(o);
  if (done) return done;
  if (!o.slots) return surveyChoice(o,mode,0,0);
  const e=paidEvidence(o);
  const supports=[...o.history.map(h=>h.quote),o.quote,...o.forecast].map(q=>[q.low,q.high]);
  const key=supports.join("|")+"/"+o.surveyFee;
  let table=plannerTables.get(key);
  if (!table) {
    prior ??= marketPrior(trainingMarkets(PAID_SUITE.splits.train.families, PAID_PATTERNS).fit.map(x=>PAID_PATTERNS[x.family].levels));
    table=compilePlanner(supports,prior,o.surveyFee);
    plannerTables.set(key,table);
  }
  const id=stateId(e.bits,e.first,e.second,e.reading);
  if (e.gate) {
    const v=table.gate.get(id);
    return surveyChoice(o,mode,v[o.slots+1],v[o.slots-1]);
  }
  const v=table.stages[o.wave].get(id);
  return freightChoice(o.offer.net+(o.slots===1 ? 0 : v[0]),v[o.slots-1],true);
}
export const choosePaidPlanner = (o,model,mode) => paidPlannerDecision(o,model,mode).action;
