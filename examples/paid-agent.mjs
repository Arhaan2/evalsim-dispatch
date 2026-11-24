// Buy with one remaining slot, then use the reading to decide how valuable waiting is.
// This simple outside policy demonstrates the API on all nine decisions.
export default function decide(o, calls) {
  if (o.phase === "survey") return o.slots === 1 ? "buy" : "skip";
  if (!calls.some(c => c.id === "accept")) return "pass";
  if (o.forecast.length < o.slots) return "accept";
  const next = o.forecast;
  const chance = o.reading === null ? o.quote.highChance : (o.reading + 1) / 8;
  const target = next.reduce((sum,q) => sum + q.low + chance * (q.high - q.low),0) / next.length;
  return o.offer.net >= target ? "accept" : "pass";
}
