// The high/low outcomes below have already been signed at decision time.
// Shrink the two recent outcomes and the older sample toward the opening bulletin.
export function turnsSignal(o) {
  const prior = o.history[0]?.quote.highChance ?? o.quote?.highChance ?? 0.5;
  const outcomes = o.history.map(entry => Number(entry.high));
  if (o.offer) outcomes.push(Number(o.offer.net === o.quote.high));
  const boundary = Math.max(0, outcomes.length - 2);
  const rate = sample => (prior + sample.reduce((sum, high) => sum + high, 0)) / (1 + sample.length);
  const recentRate = rate(outcomes.slice(boundary));
  const priorRate = rate(outcomes.slice(0, boundary));
  return { recentRate, priorRate, change: recentRate - priorRate };
}

function oddsBand(p) {
  return p < 0.35 ? "c" : p > 0.65 ? "h" : "m";
}

// All refinements after the common prefix use history. The ablation estimates
// new action values on the same samples using only the common prefix.
export function turnsKeys(o, history) {
  const keys = ["*"];
  let key = o.quote.low + "/" + o.quote.high;
  keys.push(key);
  const extend = part => { key += "|" + part; keys.push(key); };
  extend(oddsBand(o.quote.highChance));
  extend(Number(o.offer.net === o.quote.high));
  if (history) {
    // The survey in force early in the shift can differ from the current one.
    extend(o.history[3] ? oddsBand(o.history[3].quote.highChance) : "-");
    const signal = turnsSignal(o);
    extend(signal.change < -0.12 ? "down" : signal.change > 0.12 ? "up" : "flat");
    extend(o.history.slice(-2).map(entry => Number(entry.high)).join("") || "-");
    extend(Math.min(3, Math.floor(4 * signal.priorRate)));
  }
  return keys;
}

export function turnsThreshold(o, weights) {
  if (o.done || !o.slots) return null;
  if (o.wave === o.horizon - 1) return 0;
  const table = weights.tables[o.wave];
  const keys = turnsKeys(o, weights.history);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (Object.hasOwn(table, keys[i])) return table[keys[i]][o.slots - 1];
  }
  throw new Error("Turn policy checkpoint is missing its stage estimate.");
}

export function chooseTurns(o, weights) {
  if (o.done) return null;
  if (!o.slots) return "pass";
  return o.offer.net >= turnsThreshold(o, weights) ? "accept" : "pass";
}
