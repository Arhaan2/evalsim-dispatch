import { availableCalls } from "./cutoff.js";

// The same coefficients score either destination. Features use public quantities,
// departure windows and report freshness, without a "correct destination" feature.
export const featureNames = [
  "inspect action", "inspect: confirmed reports", "inspect: express slack", "inspect: express available",
  "express action", "express: local reported stock / order", "express: report confirmed", "express: normalized travel",
  "local action", "local: reported stock / order", "local: report confirmed", "local: normalized travel",
  "wait action", "wait: express window", "wait: local window",
];

function features(o, id) {
  const values = Array(featureNames.length).fill(0);
  if (id === "inspect") {
    values[0] = 1; values[1] = o.yards.filter(y => y.confirmed).length / o.yards.length;
    values[2] = Math.max(0, o.express.cutoff - o.tick); values[3] = Number(o.express.available);
  } else if (id === "wait") {
    values[12] = 1; values[13] = Number(o.express.available && o.tick <= o.express.cutoff);
    values[14] = Number(o.localAvailable && o.tick >= o.localOpens && o.tick <= o.localCutoff);
  } else {
    const [kind, index] = id.split("-");
    const i = Number(index), express = kind === "express", start = express ? 4 : 8;
    values[start] = 1; values[start + 1] = o.yards[i].reportedStock / o.orders[i].units;
    values[start + 2] = Number(o.yards[i].confirmed);
    values[start + 3] = (express ? o.orders[i].expressTravel : o.orders[i].localTravel) / 4;
  }
  return values;
}

export function distribution(obs, weights) {
  if (weights?.length !== featureNames.length || !weights.every(Number.isFinite)) throw new TypeError("Invalid cutoff policy weights.");
  const calls = availableCalls(obs);
  const vectors = calls.map(c => features(obs, c.id));
  const scores = vectors.map(v => v.reduce((sum, x, i) => sum + x * weights[i], 0));
  const offset = Math.max(...scores);
  const exps = scores.map(x => Math.exp(x - offset));
  const sum = exps.reduce((a, b) => a + b, 0);
  return { calls, vectors, probabilities: exps.map(x => x / sum) };
}

export function chooseCutoff(obs, weights) {
  if (obs.done) return null;
  const { calls, probabilities } = distribution(obs, weights);
  return calls[probabilities.indexOf(Math.max(...probabilities))].id;
}
