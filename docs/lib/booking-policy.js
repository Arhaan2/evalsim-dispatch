import { surveyDecision } from "./survey-policy.js";

// Stage and truck count are known. The opening bulletin is an independent
// coin flip; the first informative survey arrives on zero-based wave three.
export function bookingContext(o) {
  let signs = Number(o.offer.net === o.quote.high) << o.wave;
  for (const row of o.history) signs |= Number(row.high) << row.wave;
  const odds = o.wave < 3 ? 0 : Math.round(10 * o.quote.highChance);
  return { wave: o.wave, low: o.quote.low, high: o.quote.high, odds, signs };
}

// Each refinement has a populated parent. Early high/low prices on waves
// two and three help distinguish the common drop and reversal openings.
export function bookingKeys(e) {
  const signedHigh = (e.signs >> e.wave) & 1;
  const parts = ["*", e.low + "/" + e.high, signedHigh];
  if (e.wave >= 3) parts.push(e.odds <= 3 ? "cold" : e.odds >= 7 ? "hot" : "middle");
  if (e.wave >= 1) parts.push((e.signs >> 1) & 1);
  if (e.wave >= 2) parts.push((e.signs >> 2) & 1);
  if (e.wave >= 3) parts.push(e.odds, e.signs >> 1);
  parts.push(e.signs);
  let key = "";
  return parts.map(part => key = key ? key + "|" + part : String(part));
}

export function earlyValues(table, e) {
  const keys = bookingKeys(e);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (Object.hasOwn(table, keys[i])) return table[keys[i]];
  }
  throw new Error("Early-booking checkpoint is missing its stage estimates.");
}

export function bookingDecision(o, model, weights) {
  if (o.done) return { action: null, phase: "done", advantage: null, bookValue: null, waitValue: null };
  if (o.wave >= 6) {
    const decision = surveyDecision(o, weights.survey);
    return { action: decision.action, phase: "late", advantage: decision.advantage, bookValue: null, waitValue: null };
  }
  if (!o.slots) return { action: "pass", phase: "early", advantage: null, bookValue: null, waitValue: null };
  const row = earlyValues(model.tables[o.wave], bookingContext(o));
  // The signed offer is already known. The two fitted estimates are the
  // future contribution with one or two slots under this agent's continuation.
  const bookValue = o.offer.net + (o.slots === 2 ? row[0] : 0);
  const waitValue = row[o.slots - 1];
  return { action: bookValue >= waitValue ? "accept" : "pass", phase: "early",
    advantage: bookValue - waitValue, bookValue, waitValue };
}

export const chooseBooking = (o, model, weights) => bookingDecision(o, model, weights).action;
