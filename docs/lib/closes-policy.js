// The two estimators share the complete public board and current signed offer.
// The stage selects a separate table; the truck count selects one column.
export function publicClosesKeys(o) {
  const board = [o.quote, ...o.forecast];
  const supports = board.map(q => q.low + "/" + q.high).join(",");
  const currentHigh = Number(o.offer.net === o.quote.high);
  const odds = board.every(q => q.highChance === o.quote.highChance)
    ? String(o.quote.highChance) : board.map(q => q.highChance).join(",");
  const band = o.quote.highChance < 0.35 ? "low" : o.quote.highChance > 0.65 ? "high" : "mid";
  const keys = ["*", supports];
  function extend(value) { keys.push(keys.at(-1) + "|" + value); }
  extend(band);
  extend(currentHigh);
  extend(odds);
  return keys;
}

// Refine a shared feature path with the latest signed observations first.
// The earlier survey can distinguish a rebound from a sustained move.
export function extendClosesHistory(keys, history) {
  function extend(value) { keys.push(keys.at(-1) + "|" + value); }
  for (const offer of history.slice(-3).reverse()) extend(Number(offer.high));
  if (history.length > 3) {
    const survey = history[3].quote.highChance;
    extend(survey < 0.35 ? "low" : survey > 0.65 ? "high" : "mid");
    extend(history.slice(0, -3).reduce((sum, offer) => sum + Number(offer.high), 0));
  }
}

export function closesThreshold(o, weights) {
  if (o.done || !o.slots) return null;
  if (o.wave === o.horizon - 1) return 0;
  const table = weights.tables[o.wave];
  const keys = publicClosesKeys(o);
  if (weights.history) extendClosesHistory(keys, o.history);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (Object.hasOwn(table, keys[i])) return table[keys[i]][o.slots - 1];
  }
  throw new Error("Missing continuation estimate in the balanced-closes checkpoint.");
}

export function chooseCloses(o, weights) {
  if (o.done) return null;
  if (!o.slots) return "pass";
  return o.offer.net >= closesThreshold(o, weights) ? "accept" : "pass";
}
