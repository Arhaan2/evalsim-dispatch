// Reserve v1. Policies receive observeReserve(state) and reserveCalls(observation).
export const RESERVE_VERSION = "reserve-v1.0.0";
export const RESERVE_FAMILIES = Object.freeze(["steady", "surge", "volatile"]);

const CAPACITY = 2;
const LANES = ["Canal Market", "East Wharf", "Ridge Arcade", "Mill Exchange",
  "Park Stores", "Inlet Market", "Pier Exchange", "Foundry Stores"];
const COSTS = [3, 5, 4, 6, 3, 4, 5, 6];

function quote(low, high = low, highChance = 0) {
  return Object.freeze({ low, high, highChance, mean: low + highChance * (high - low) });
}

// Each conditional law is on the public board before a decision.
// One of two schedules is equally likely in each family. A common random tape selects
// each signed contribution independently from its posted two-point forecast.
const steady = [quote(8), quote(10), quote(9), quote(13), quote(8), quote(10), quote(12), quote(9)];
const contract = quote(8, 12, 0.5);
const spot = quote(2, 32, 0.25);
const exportLoad = quote(1, 39, 0.25);
const parcel = quote(5, 19, 0.5);
const BOOK = {
  steady: [steady, [...steady].reverse()],
  surge: [
    [contract, contract, quote(7, 11, 0.5), spot, spot, spot, spot, spot],
    [contract, quote(7, 11, 0.5), contract, contract, spot, spot, exportLoad, exportLoad],
  ],
  volatile: [
    [quote(11, 15, 0.5), parcel, spot, parcel, exportLoad, contract, exportLoad, spot],
    [parcel, quote(11, 15, 0.5), exportLoad, contract, parcel, spot, parcel, exportLoad],
  ],
};

function demandTape(seed, family) {
  let state = seed >>> 0;
  function draw() {
    state = (state + 0x6d2b79f5) >>> 0;
    let word = Math.imul(state ^ (state >>> 15), state | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  }
  const board = BOOK[family][Math.floor(draw() * 2)];
  const offers = board.map(({ low, high, highChance }, wave) => {
    const net = draw() < highChance ? high : low;
    const cost = COSTS[wave];
    return { lane: LANES[wave], revenue: net + cost, cost, net };
  });
  return { board, offers };
}

export function createReserve({ seed, family = "surge" }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!RESERVE_FAMILIES.includes(family)) throw new RangeError("Unknown Reserve family.");
  const { board, offers } = demandTape(seed, family);
  return { seed, family, board: board.slice(), offers, wave: 0, slots: CAPACITY, net: 0, done: false, calls: [], loads: [] };
}

export function observeReserve(s) {
  return {
    wave: s.wave, horizon: LANES.length, slots: s.slots, capacity: CAPACITY, done: s.done, net: s.net,
    offer: s.done ? null : { ...s.offers[s.wave] },
    forecast: s.board.slice(s.wave + 1).map(law => ({ ...law })),
  };
}

export function reserveCalls(o) {
  if (o.done) return [];
  const calls = [];
  if (o.slots > 0) calls.push({ id: "accept", label: "Accept this load" });
  calls.push({ id: "pass", label: "Pass this load" });
  return calls;
}

export function stepReserve(s, id) {
  if (s.done || (id !== "pass" && (id !== "accept" || s.slots < 1))) {
    throw new RangeError("Unavailable Reserve call: " + id);
  }
  if (id === "accept") {
    const { lane, revenue, cost } = s.offers[s.wave];
    s.loads.push({ wave: s.wave, lane, revenue, cost });
    s.slots--;
    s.net += revenue - cost;
  }
  s.calls.push({ wave: s.wave, id });
  s.wave++;
  s.done = s.wave === LANES.length;
  return observeReserve(s);
}

// Independently rebuild signed offers and reconcile bookings, remaining slots and contribution.
export function verifyReserve(s) {
  const violations = [];
  const { offers } = demandTape(s.seed, s.family);
  const accepted = s.calls.filter(c => c.id === "accept");
  if (!Number.isInteger(s.wave) || s.wave < 0 || s.wave > LANES.length ||
      s.wave !== s.calls.length || s.done !== (s.wave === LANES.length)) violations.push("Wave clock mismatch.");
  if (s.calls.some((c, wave) => c.wave !== wave || !["accept", "pass"].includes(c.id))) violations.push("Invalid decision log.");
  if (s.loads.length !== accepted.length || s.loads.length > CAPACITY ||
      s.slots !== CAPACITY - s.loads.length) violations.push("Capacity mismatch.");
  let net = 0;
  for (const [index, load] of s.loads.entries()) {
    const offer = offers[load.wave];
    if (!offer || load.wave !== accepted[index]?.wave || load.lane !== offer.lane ||
        load.revenue !== offer.revenue || load.cost !== offer.cost) violations.push("Signed load mismatch.");
    net += load.revenue - load.cost;
  }
  if (net !== s.net) violations.push("Contribution mismatch.");
  return { net, accepted: accepted.length, usedSlots: s.loads.length, capacity: CAPACITY, waves: s.wave, violations };
}

// A certainty-equivalent rolling plan fills the available slots with the best remaining
// contributions, replacing each unknown future offer by its exact conditional mean.
export function pointPlanner(o) {
  if (o.done) return null;
  if (!o.slots) return "pass";
  const means = o.forecast.map(law => law.mean).sort((a, b) => b - a);
  const displaced = means[o.slots - 1] ?? 0;
  return o.offer.net >= displaced ? "accept" : "pass";
}

// Bellman recursion for the public independent demand laws. An operator can adapt after
// observing each subsequent offer. No future sampled offer is available to this planner.
export function stochasticPlanner(o) {
  if (o.done) return null;
  if (!o.slots) return "pass";
  const value = Array(o.slots + 1).fill(0);
  for (let i = o.forecast.length - 1; i >= 0; i--) {
    const { low, high, highChance } = o.forecast[i];
    for (let slots = o.slots; slots > 0; slots--) {
      const skip = value[slots], afterBooking = value[slots - 1];
      value[slots] = (1 - highChance) * Math.max(skip, low + afterBooking)
        + highChance * Math.max(skip, high + afterBooking);
    }
  }
  return o.offer.net + value[o.slots - 1] >= value[o.slots] ? "accept" : "pass";
}
