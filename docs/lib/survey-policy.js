// Market evidence is encoded once per observation. Price bits include today's
// signed offer; q1 and q2 are the two actual survey releases (waves 4 and 7).
export function surveyEvidence(o, surveys = true) {
  let bits = Number(o.offer.net === o.quote.high) << o.wave;
  for (const row of o.history) bits |= Number(row.high) << row.wave;
  const bulletin = t => Math.round(10 * (t === o.wave ? o.quote : o.history[t].quote).highChance);
  return { wave: o.wave, bits, first: surveys && o.wave >= 3 ? bulletin(3) : 0,
    second: surveys && o.wave >= 6 ? bulletin(6) : 0, low: o.quote.low, high: o.quote.high };
}

const band = q => q === 0 ? "-" : q < 4 ? "low" : q > 6 ? "high" : "mid";
const direction = q => q < 5 ? -1 : q > 5 ? 1 : 0;
const latest = e => e.wave >= 6 ? e.second : e.first;
function signedFeatures(e) {
  const start = Math.max(0, e.wave - 2);
  const lastThree = e.bits >> start;
  const pair = e.bits >> Math.max(0, e.wave - 1);
  let older = 0;
  for (let i = 0; i < start; i++) older += (e.bits >> i) & 1;
  return { high: (e.bits >> e.wave) & 1, pair, lastThree, older: Math.sign(2 * older - start) };
}

export function forecastPath(e, survey) {
  const { high, pair, lastThree, older } = signedFeatures(e);
  const parts = ["*", high, pair];
  if (survey && e.wave >= 3) parts.push(direction(latest(e)));
  parts.push(lastThree, older);
  if (survey && e.wave >= 3) parts.push(band(latest(e)));
  if (survey && e.wave >= 6) parts.push(band(e.first), Math.sign(e.second - e.first));
  return prefixes(parts);
}

export function returnPath(e, survey) {
  const { high, pair, lastThree, older } = signedFeatures(e);
  const parts = ["*", e.low + "/" + e.high, high];
  // The first delayed bulletin describes the opening and can help identify
  // market type. The second survey enters slot valuation through the gate.
  if (survey && e.wave >= 3) parts.push(band(e.first));
  parts.push(pair, lastThree, older);
  return prefixes(parts);
}

function prefixes(parts) {
  let key = "";
  return parts.map(part => key = key ? key + "|" + part : String(part));
}

export function lookup(table, keys) {
  for (let i = keys.length - 1; i >= 0; i--) {
    if (Object.hasOwn(table, keys[i])) return table[keys[i]];
  }
  throw new Error("Survey checkpoint is missing its stage estimate.");
}

export function surveyProbability(e, model) {
  if (model.kind === "always" && e.wave >= 3) return latest(e) / 10;
  const layer = model.forecast[e.wave];
  const raw = lookup(layer.raw, forecastPath(e, model.kind === "learned"));
  // Monotone probabilities for ten bins, fitted on separate training stems.
  return layer.curve[Math.min(9, Math.floor(raw * 10))];
}

export function mixSlotCosts(p, row) {
  // Row layout: mean sample priority, then the two conditional marginal
  // slot costs for cold; followed by the same three estimates for hot.
  const hotMass = p * row[3], coldMass = (1 - p) * row[0];
  const hotBookingWeight = hotMass / (hotMass + coldMass);
  return { hotBookingWeight,
    one: (1 - hotBookingWeight) * row[1] + hotBookingWeight * row[4],
    two: (1 - hotBookingWeight) * row[2] + hotBookingWeight * row[5] };
}

const cached = new WeakMap();
function decisionAt(o, model, diagnostic) {
  if (o.done) return { action: null, persistence: null, misleading: null, advantage: null, hotBookingWeight: null };
  const e = surveyEvidence(o, model.kind !== "never");
  // Slots and current net are applied after looking up the conditional costs.
  const id = [e.wave, e.bits, e.first, e.second, e.low, e.high].join("/");
  let bank = cached.get(model);
  if (!bank) cached.set(model, bank = new Map());
  let decision = bank.get(id);
  if (!decision) {
    const persistence = surveyProbability(e, model);
    const row = lookup(model.returns[e.wave], returnPath(e, model.kind !== "never"));
    decision = { persistence, ...mixSlotCosts(persistence, row) };
    bank.set(id, decision);
  }
  const { persistence, hotBookingWeight } = decision;
  // Only the diagnostic needs the bulletin's direction to phrase the same
  // signed-only probability as a forecast of a directional error.
  const q = diagnostic && o.wave >= 3 ? o.quote.highChance : null;
  const misleading = q === null || q === 0.5 ? null : q > 0.5 ? 1 - persistence : persistence;
  const advantage = o.slots ? o.offer.net - (o.slots === 1 ? decision.one : decision.two) : null;
  const action = o.slots && advantage >= 0 ? "accept" : "pass";
  return { action, persistence, misleading, hotBookingWeight, advantage };
}

export const surveyDecision = (o, model) => decisionAt(o, model, true);
export const chooseSurvey = (o, model) => decisionAt(o, model, false).action;
