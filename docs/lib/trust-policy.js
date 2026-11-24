import { stochasticPlanner } from "./reserve.js";
import { chooseCloses } from "./closes-policy.js";
import { chooseDrift } from "./drift-policy.js";

export const TRUST_EXPERTS = Object.freeze(["stochastic", "closes", "drift"]);

// One bit for each expert that recommends booking, in TRUST_EXPERTS order.
export function expertMask(o, experts, specialist) {
  let mask = Number(stochasticPlanner(o) === "accept");
  if (chooseCloses(o, experts.closes) === "accept") mask |= 2;
  if (specialist && chooseDrift(o, experts.drift) === "accept") mask |= 4;
  return mask;
}

const band = p => p <= 0.3 ? "l" : p >= 0.7 ? "h" : "m";

// Clock and capacity select the table. These public inputs and expert votes
// define the common part of all three routers' feature hierarchies.
export function trustKeys(o, mask) {
  const offer = o.quote.low + "/" + o.quote.high + "/" + o.offer.net;
  const vote = offer + "|" + mask;
  const bulletin = vote + "|" + band(o.quote.highChance);
  return ["*", offer, vote, bulletin, bulletin + "|" + o.quote.highChance];
}

export function extendTrustKeys(keys, history) {
  function append(value) { keys.push(keys.at(-1) + "|" + value); }
  if (history.length >= 4) append(band(history[3].quote.highChance));
  for (const entry of history.slice(-3).reverse()) append(Number(entry.high));
  if (history.length > 3) append(history.slice(0, -3).reduce((sum, row) => sum + Number(row.high), 0));
}

function routed(o, weights, experts, explain) {
  const ids = weights.specialist ? TRUST_EXPERTS : TRUST_EXPERTS.slice(0, 2);
  const all = weights.specialist ? 7 : 3;
  const mask = !o.done && o.slots ? expertMask(o, experts, weights.specialist) : 0;
  let action, status, advantage = null;
  if (o.done) { status = "done"; action = null; }
  else if (!o.slots) { status = "capacity"; action = "pass"; }
  else if (mask === 0 || mask === all) { status = "agreement"; action = mask === all ? "accept" : "pass"; }
  else {
    status = "disagreement";
    const table = weights.tables[o.wave][o.slots - 1];
    const keys = trustKeys(o, mask);
    if (weights.history) extendTrustKeys(keys, o.history);
    for (let i = keys.length - 1; i >= 0; i--) {
      if (Object.hasOwn(table, keys[i])) { advantage = table[keys[i]]; break; }
    }
    // An unseen stage/capacity disagreement, or exactly equal estimated
    // returns, follows the planner. Either action has an actual adviser.
    const accept = advantage === null || advantage === 0 ? Boolean(mask & 1) : advantage > 0;
    action = accept ? "accept" : "pass";
  }
  if (!explain) return action;
  const advice = Object.fromEntries(ids.map((id, i) => [id, o.done ? null : mask & (1 << i) ? "accept" : "pass"]));
  const supporters = o.done || !o.slots ? [] : ids.filter(id => advice[id] === action);
  return { action, advice, status, supporters, advantage };
}

export const chooseTrust = (o, weights, experts) => routed(o, weights, experts, false);
export const trustDecision = (o, weights, experts) => routed(o, weights, experts, true);
