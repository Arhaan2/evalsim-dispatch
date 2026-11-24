import { tariffDecision, tariffPlannerDecision } from "./tariff-policy.js";

// Both public freight boards have distinct first-wave price supports.
export const boardKey = q => q.low + "/" + q.high;
export const gateKey = (bulletin,bits) => 32*(bulletin-1)+(bits&31);
export const sixKey = (reading,high6) => 2*(reading+1)+Number(high6);
export const sevenKey = (six,bulletin,high7) => 2*(9*six+bulletin-1)+Number(high7);

// Wait values are fixed-point thousandths of a credit. An explicit byte order
// makes the public JSON checkpoint portable across Node and browser engines.
const cache = new WeakMap();
export function packWait(values) {
  return btoa(Array.from(values, value => {
    const n=Math.round(1000*value);
    if (n<0 || n>65535 || !Number.isFinite(n)) throw new RangeError("Invalid wait value.");
    return String.fromCharCode(n&255,n>>8);
  }).join(""));
}
export function waitValues(row) {
  if (!cache.has(row)) {
    const bytes=atob(row.wait), values=new Float64Array(bytes.length/2);
    for (let j=0;j<values.length;j++) values[j]=(bytes.charCodeAt(2*j)+256*bytes.charCodeAt(2*j+1))/1000;
    cache.set(row,values);
  }
  return cache.get(row);
}

const empty = {buyValue:null,skipValue:null,advantage:null,bookValue:null,waitValue:null};
export function lastslotDecision(o,model,priors,mode="optional") {
  const gate=o.phase==="survey";
  if (gate && o.slots!==1) return {...empty,action:"skip"};
  if (o.done || !o.slots || o.wave===7) return tariffPlannerDecision(o,null);
  if (o.wave<5 || o.slots===2) return model.opening==="tariff" ?
    tariffDecision(o,priors.tariff) : tariffPlannerDecision(o,null);
  let bits=0;
  for (let w=0;w<5;w++) if(o.history[w].high) bits|=1<<w;
  const first=Math.round(10*o.history[3].quote.highChance);
  const row=model.boards[boardKey(o.history[0].quote)][gateKey(first,bits)];
  if (gate) {
    const advantage=row.delta-o.surveyFee;
    const buy=mode==="always" || (mode!=="never" && advantage>1e-10);
    return {...empty,action:buy?"buy":"skip",skipValue:row.skip,buyValue:row.skip+advantage,advantage};
  }
  const six=sixKey(o.reading??-1,o.wave===5 ? o.offer.net===o.quote.high : o.history[5].high);
  const index=o.wave===5 ? six : 16+sevenKey(six,Math.round(10*o.quote.highChance),o.offer.net===o.quote.high);
  const waitValue=waitValues(row)[index],bookValue=o.offer.net;
  return {...empty,action:bookValue>=waitValue-1e-10?"accept":"pass",waitValue,bookValue,advantage:bookValue-waitValue};
}
export const chooseLastslot=(o,model,priors,mode)=>lastslotDecision(o,model,priors,mode).action;
