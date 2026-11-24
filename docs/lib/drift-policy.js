// Fitted Q features depend only on signed offers, public forecasts and observed history.
// Each stage and capacity has separate pass and accept coefficients.
export function driftFeatures(o) {
  const price = 32;
  const futureCount = Math.max(1, o.forecast.length);
  const next = o.forecast[0];
  const last = o.forecast.at(-1);
  let sumMean = 0, sumHigh = 0, sumLow = 0, maxMean = 0;
  for (const law of o.forecast) {
    sumMean += law.mean;
    sumHigh += law.high;
    sumLow += law.low;
    maxMean = Math.max(maxMean, law.mean);
  }
  const surprise = Number(o.offer.net === o.quote.high) - o.quote.highChance;
  let recent = 0, total = 0;
  for (const past of o.history) {
    const error = Number(past.high) - past.quote.highChance;
    recent = 0.5 * recent + 0.5 * error;
    total += error;
  }
  return [
    1, o.offer.net / price, o.quote.highChance,
    (next?.mean ?? 0) / price, (last?.mean ?? 0) / price,
    sumMean / futureCount / price, sumHigh / futureCount / price, sumLow / futureCount / price,
    maxMean / price, (next?.highChance ?? 0), (last?.highChance ?? 0),
    surprise, 0.5 * recent + 0.5 * surprise, (total + surprise) / (o.history.length + 1),
  ];
}

export function driftQ(coefficients, features) {
  let sum = 0;
  for (let i = 0; i < features.length; i++) sum += coefficients[i] * features[i];
  return sum;
}

export function chooseDrift(observation, weights) {
  if (observation.done) return null;
  if (observation.slots === 0) return "pass";
  const [pass, accept] = weights[observation.wave][observation.slots];
  const features = driftFeatures(observation);
  return driftQ(accept, features) >= driftQ(pass, features) ? "accept" : "pass";
}
