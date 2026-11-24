// Cutoff shift v2. Only observeShift and availableCalls belong in an operator.
export const CUTOFF_VERSION = "2.0.0";
export const FAMILIES = ["uncertain", "urgent"];
const NETWORKS = {
  train: [["Canal Yard", "Canal Market", "Mill Yard", "Mill Exchange"], ["Park Yard", "Park Arcade", "Dock Yard", "Dock Stores"]],
  validation: [["Quay Yard", "Quay Exchange", "Foundry Yard", "Foundry Stores"]],
  test: [["Ridge Yard", "Ridge Arcade", "Inlet Yard", "Inlet Market"], ["Pier Yard", "Pier Exchange", "Bluff Yard", "Bluff Stores"]],
};

function randomStream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export function createShift({ seed, split = "train", variant = 0, family = "uncertain" }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Use an unsigned 32-bit seed.");
  if (!Object.hasOwn(NETWORKS, split) || !FAMILIES.includes(family) || ![0, 1].includes(variant)) throw new RangeError("Unknown shift configuration.");
  const random = randomStream(seed);
  const draw = (min, max) => min + Math.floor(random() * (max - min + 1));
  const labels = NETWORKS[split][draw(0, NETWORKS[split].length - 1)];
  const sides = draw(0, 1) ? [0, 1] : [1, 0];
  const cutoff = family === "urgent" ? 0 : split === "test" ? draw(2, 3) : draw(1, 2);
  const localOpens = cutoff + (split === "test" ? draw(2, 3) : 1);
  const localCutoff = localOpens + 1;
  const orders = sides.map((side, i) => {
    const expressTravel = draw(1, split === "test" ? 4 : 2);
    const localTravel = draw(split === "test" ? 2 : 1, split === "test" ? 4 : 2);
    return { id: "order-" + i, name: labels[side * 2 + 1], units: draw(4, split === "test" ? 13 : 9),
      expressTravel, localTravel, deadline: Math.max(cutoff + expressTravel, localOpens + localTravel) + draw(0, 1) };
  });
  const stock = orders.map((order, i) => i === variant ? order.units : 0);
  const confirmed = family === "urgent";
  return {
    tick: 0, done: false, budget: 7, spent: 0, cutoff, localOpens, localCutoff,
    horizon: Math.max(...orders.map(o => o.deadline), localCutoff + 4),
    orders, stock: stock.slice(), initialStock: stock, expressStock: Math.max(...orders.map(o => o.units)),
    yards: sides.map((side, i) => ({ name: labels[side * 2], confirmed, reportedStock: confirmed ? stock[i] : orders[i].units })),
    inspected: false, trips: [], calls: [], events: [{ tick: 0, text: confirmed ? "Signed yard counts received before departure." : "Both yards filed expected stock. Physical counts are pending." }],
  };
}

export function observeShift(s) {
  return {
    tick: s.tick, done: s.done, budget: s.budget, spent: s.spent,
    orders: s.orders.map((order, i) => {
      const trip = s.trips.find(t => t.order === i);
      return { ...order, assigned: Boolean(trip), delivered: Boolean(trip?.delivered) };
    }),
    yards: s.yards.map(y => ({ ...y })), inspected: s.inspected,
    express: { name: "Central express", available: !s.trips.some(t => t.carrier === "express"), cutoff: s.cutoff },
    localOpens: s.localOpens, localCutoff: s.localCutoff, localAvailable: !s.trips.some(t => t.carrier === "local"),
    events: s.events.map(e => ({ ...e })),
  };
}

export function availableCalls(o) {
  if (o.done) return [];
  const calls = [];
  const funds = o.budget - o.spent;
  if (!o.inspected && funds >= 1) calls.push({ id: "inspect", label: "Inspect both yards" });
  for (const [i, order] of o.orders.entries()) {
    if (order.assigned) continue;
    if (o.express.available && o.tick <= o.express.cutoff && funds >= 4)
      calls.push({ id: "express-" + i, label: "Send express to " + order.name });
    if (o.localAvailable && o.localOpens <= o.tick && o.tick <= o.localCutoff && funds >= 2)
      calls.push({ id: "local-" + i, label: "Book " + o.yards[i].name + " for " + order.name });
  }
  calls.push({ id: "wait", label: "Wait for the next dispatch window" });
  return calls;
}

function settleAt(s, tick) {
  const arriving = s.trips.filter(t => !t.delivered && t.arrival <= tick).sort((a, b) => a.arrival - b.arrival);
  for (const trip of arriving) {
    trip.delivered = true;
    const order = s.orders[trip.order];
    s.events.push({ tick: trip.arrival, text: order.units + " units arrived at " + order.name + "." });
  }
  s.tick = tick;
}

export function stepShift(s, actionId) {
  const o = observeShift(s);
  if (!availableCalls(o).some(a => a.id === actionId)) throw new RangeError("Unavailable cutoff call: " + actionId);
  let next = s.tick + 1, cost = 0, accepted = true;
  let message;
  if (actionId === "inspect") {
    cost = 1; s.inspected = true;
    for (const [i, yard] of s.yards.entries()) { yard.confirmed = true; yard.reportedStock = s.stock[i]; }
    message = "Physical count: " + s.yards.map(y => y.name + " " + y.reportedStock).join(", ") + ".";
  } else if (actionId === "wait") {
    const windows = [s.cutoff, s.localOpens, s.localCutoff + 1];
    next = Math.min(...windows.filter(t => t > s.tick));
    message = "Held dispatch until tick " + next + ".";
  } else {
    const [carrier, index] = actionId.split("-");
    const i = Number(index), order = s.orders[i], express = carrier === "express";
    accepted = express || s.stock[i] >= order.units;
    if (accepted) {
      cost = express ? 4 : 2;
      const arrival = s.tick + (express ? order.expressTravel : order.localTravel);
      s.trips.push({ carrier, order: i, quantity: order.units, departure: s.tick, arrival, delivered: false });
      if (express) s.expressStock -= order.units;
      else {
        s.stock[i] -= order.units;
        s.yards[i].confirmed = true;
        s.yards[i].reportedStock = s.stock[i];
      }
      message = (express ? "Central express" : s.yards[i].name) + " dispatched " + order.units + " units to " + order.name + ".";
    } else {
      s.yards[i].confirmed = true;
      s.yards[i].reportedStock = s.stock[i];
      message = s.yards[i].name + " rejected the booking: insufficient stock.";
    }
  }
  s.calls.push({ tick: s.tick, id: actionId, accepted, cost });
  s.events.push({ tick: s.tick, text: message });
  s.spent += cost;
  settleAt(s, next);
  if (s.trips.length === s.orders.length || s.tick > s.localCutoff) {
    settleAt(s, Math.max(s.tick, ...s.trips.map(t => t.arrival)));
    s.done = true;
  }
  return observeShift(s);
}

// Reconcile physical loads, windows, stock and charges from separate call and freight records.
export function verifyShift(s) {
  const violations = [];
  const stock = s.initialStock.slice(), seenOrders = new Set(), seenCarriers = new Set();
  let central = Math.max(...s.orders.map(o => o.units)), onTimeUnits = 0;
  for (const t of s.trips) {
    const o = s.orders[t.order], express = t.carrier === "express";
    if (!o || !["express", "local"].includes(t.carrier)) { violations.push("Unknown freight route."); continue; }
    if (seenOrders.has(t.order) || seenCarriers.has(t.carrier)) violations.push("Double allocation.");
    seenOrders.add(t.order); seenCarriers.add(t.carrier);
    if (express) central -= t.quantity; else stock[t.order] -= t.quantity;
    const booking = s.calls.filter(c => c.accepted && c.tick === t.departure && c.id === t.carrier + "-" + t.order);
    if (booking.length !== 1 || t.quantity !== o.units || t.arrival !== t.departure + (express ? o.expressTravel : o.localTravel) ||
        (express ? t.departure > s.cutoff : t.departure < s.localOpens || t.departure > s.localCutoff)) violations.push("Freight manifest mismatch.");
    if (t.delivered !== (t.arrival <= s.tick)) violations.push("Freight arrival mismatch.");
    if (t.delivered && t.arrival <= o.deadline) onTimeUnits += t.quantity;
  }
  const acceptedBookings = s.calls.filter(c => c.accepted && /^(express|local)-/.test(c.id));
  if (acceptedBookings.length !== s.trips.length) violations.push("Booking count mismatch.");
  let spend = 0;
  for (const c of s.calls) {
    const expected = !c.accepted || c.id === "wait" ? 0 : c.id === "inspect" ? 1 : c.id.startsWith("local-") ? 2 : 4;
    if (expected !== c.cost) violations.push("Charge mismatch.");
    spend += expected;
  }
  if (spend !== s.spent || spend > s.budget || central !== s.expressStock || central < 0 ||
      stock.some((q, i) => q < 0 || q !== s.stock[i])) violations.push("Resource reconciliation failed.");
  const totalUnits = s.orders.reduce((sum, o) => sum + o.units, 0);
  return { success: s.done && !violations.length && onTimeUnits === totalUnits, onTimeUnits, totalUnits,
    calls: s.calls.length, spend, violations };
}

export function rewardShift(metrics) {
  return Number(metrics.success) + metrics.onTimeUnits / metrics.totalUnits - 0.025 * metrics.spend - 0.01 * metrics.calls;
}

function dispatchFromReports(obs, inspect) {
  const menu = availableCalls(obs);
  if (!menu.length) return null;
  const has = id => menu.some(a => a.id === id);
  if (inspect && has("inspect") && obs.tick < obs.express.cutoff && obs.yards.some(y => !y.confirmed)) return "inspect";
  const indexes = [0, 1].sort((i, j) => obs.yards[i].reportedStock / obs.orders[i].units - obs.yards[j].reportedStock / obs.orders[j].units);
  for (const i of indexes) if (has("express-" + i)) return "express-" + i;
  for (const i of indexes.reverse()) if (has("local-" + i)) return "local-" + i;
  return "wait";
}

export const planner = obs => dispatchFromReports(obs, true);
export const noCheck = obs => dispatchFromReports(obs, false);
