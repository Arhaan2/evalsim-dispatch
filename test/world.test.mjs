import test from "node:test";
import assert from "node:assert/strict";
import {
  availableActions, createWorld, dispatcher, feasiblePlan, makeScenario,
  observe, SCENARIOS, snapshot, step, verify,
} from "../docs/lib/world.js";

const wait = { tool: "advance_time" };
const audit = (world) => assert.deepEqual(verify(world).violations, []);

function episode(seed, kind, actor) {
  const w = createWorld(makeScenario(seed, kind));
  const trace = [];
  while (!w.done) {
    const a = actor(w);
    trace.push([a, step(w, a)]);
  }
  return { result: verify(w), trace };
}

test("seeded scenarios replay the same decisions, events and accounting", () => {
  const actor = (w) => dispatcher(observe(w));
  for (const { id } of SCENARIOS) {
    assert.deepEqual(episode(98765, id, actor), episode(98765, id, actor));
  }
});

test("public reports isolate latent stock, carrier availability, and future demand", () => {
  const w = createWorld(makeScenario(77, "compound"));
  const { route } = w.events.find((e) => e.type === "closure");
  const view = observe(w);
  assert(!("scenario" in view));
  assert(!("stock" in view.warehouses[0]));
  assert(!("actualEta" in view.suppliers[0]));
  assert(!("capacityLimit" in view.routes[0]));
  assert(!view.events.some((e) => e.type === "demand-surge"));
  assert.equal(view.routes.find((r) => r.id === route).open, true);
  assert.equal(snapshot(w).routes.find((r) => r.id === route).open, false);
  view.orders[0].demand = 991;
  view.events[0].message = "modified";
  assert.notEqual(observe(w).orders[0].demand, 991);
  assert.notEqual(observe(w).events[0].message, "modified");
  step(w, { tool: "check_transport_capacity", route });
  assert.equal(observe(w).routes.find((r) => r.id === route).open, false);
  audit(w);
});

test("a booking spends money and moves stock, but only physical arrival earns delivery credit", () => {
  const w = createWorld(makeScenario(9, "normal"));
  const order = w.orders[0];
  const route = w.routes.find((r) => r.customer === order.customer && w.warehouses.find((d) => d.id === r.source).stock > 0);
  const warehouse = w.warehouses.find((d) => d.id === route.source);
  const prev = warehouse.stock;
  const budget = w.budget;
  const result = step(w, { tool: "book_shipment", route: route.id, order: order.id, quantity: 1 });
  assert(result.ok);
  assert.equal(warehouse.stock, prev - 1);
  assert.equal(w.budget, budget - route.cost);
  assert.equal(verify(w).fulfilled, 0);
  assert.equal(order.inTransit, 1);
  while (w.tick < route.travel) step(w, wait);
  assert.equal(verify(w).fulfilled, 1);
  assert.equal(order.inTransit, 0);
  audit(w);
});

test("blocked transactions leave payables and bookings intact; rejected calls consume a decision", () => {
  const w = createWorld(makeScenario(12345, "route-closure"));
  const closed = w.routes.find((r) => !r.open);
  const order = w.orders.find((o) => o.customer === closed.customer);
  for (const a of [
    { tool: "book_shipment", order: order.id, route: closed.id, quantity: 1 },
    { tool: "purchase_inventory", supplier: "s0", quantity: -1 },
    { tool: "reserve_inventory", order: order.id, warehouse: "w0", quantity: 1.5 },
    { tool: "purchase_inventory", supplier: "s9", quantity: 1 },
    { tool: "purchase_inventory", supplier: "s0", quantity: Number.MAX_SAFE_INTEGER },
  ]) {
    const beforeCalls = w.decisions;
    const beforeBudget = w.budget;
    const beforeBookings = w.shipments.length;
    assert.equal(step(w, a).ok, false);
    assert.equal(w.decisions, beforeCalls + 1);
    assert.equal(w.budget, beforeBudget);
    assert.equal(w.shipments.length, beforeBookings);
    audit(w);
  }
  assert.equal(verify(w).rejectedActions, 5);
});

test("reservations are exclusive and are discharged when their order ships", () => {
  const w = createWorld(makeScenario(42, "normal"));
  const [a, b] = w.orders;
  const depot = w.warehouses[0];
  const qty = Math.min(depot.stock, a.demand);
  const result = step(w, { tool: "reserve_inventory", warehouse: depot.id, order: a.id, quantity: qty });
  assert(result.ok);
  assert.equal(snapshot(w).warehouses[0].available, depot.stock - qty);
  const busy = step(w, { tool: "reserve_inventory", warehouse: depot.id, order: b.id, quantity: depot.stock - qty + 1 });
  assert.equal(busy.ok, false);
  assert(step(w, { tool: "book_shipment", route: depot.id + "-" + a.customer, order: a.id, quantity: qty }).ok);
  assert.deepEqual(w.reservations, []);
  audit(w);
});

test("split shipments credit each physical arrival and protect already booked units", () => {
  const w = createWorld(makeScenario(9981, "normal"));
  const o = w.orders[0];
  for (const yard of w.warehouses) {
    assert(step(w, { tool: "book_shipment", route: yard.id + "-" + o.customer, order: o.id, quantity: 1 }).ok);
  }
  assert.equal(o.inTransit, 2);
  assert.equal(o.delivered, 0);
  assert(!step(w, { tool: "book_shipment", route: "w0-" + o.customer, order: o.id, quantity: o.demand }).ok);
  for (let i = 0; i < 3; i++) step(w, wait);
  assert.equal(o.delivered, 2);
  assert.equal(o.onTime, 2);
  audit(w);
});

test("a constrained carrier rejects overflow and resets its available capacity on the next tick", () => {
  const w = createWorld(makeScenario(1, "capacity-cut"));
  const blocked = w.events.find((e) => e.type === "capacity-cut");
  const r = w.routes.find((r) => r.id === blocked.route);
  const o = w.orders.find((o) => o.customer === r.customer);
  const book = (n) => step(w, { tool: "book_shipment", order: o.id, route: r.id, quantity: n });
  assert(book(r.capacityLimit).ok);
  assert(!book(1).ok);
  assert.equal(snapshot(w).routes.find((x) => x.id === r.id).remainingCapacity, 0);
  step(w, wait);
  assert.equal(snapshot(w).routes.find((x) => x.id === r.id).remainingCapacity, r.capacityLimit);
  assert(book(1).ok);
  audit(w);
});

test("external demand and supplier changes run on business time independent of tools used", () => {
  for (const kind of ["demand-surge", "supplier-delay", "network-shift"]) {
    const w = createWorld(makeScenario(82, kind));
    const other = createWorld(makeScenario(82, kind));
    for (let i = 0; i < 2; i++) step(w, wait);
    for (let i = 0; i < 8; i++) step(other, { tool: "inspect_orders" });
    assert.equal(w.tick, other.tick);
    assert.deepEqual(w.events.map(({ decision, ...e }) => e), other.events.map(({ decision, ...e }) => e));
    assert.equal(w.shipments[0].status, other.shipments[0].status);
    assert.deepEqual(w.orders, other.orders);
    audit(w);
    audit(other);
  }
});

test("tracking a delayed shipment exposes the revised arrival without new delivery credit", () => {
  const w = createWorld(makeScenario(12, "supplier-delay"));
  step(w, wait);
  assert.equal(w.tick, 1);
  assert.equal(snapshot(w).shipments[0].arrival, 3);
  assert.equal(observe(w).shipments[0].arrival, 1);
  const tracked = step(w, { tool: "track_shipment", shipment: "sh0" });
  assert(tracked.ok);
  assert.equal(observe(w).shipments[0].arrival, 3);
  assert.equal(verify(w).fulfilled, 0);
  audit(w);
});

test("late arrivals do not satisfy the on-time obligation", () => {
  const s = makeScenario(42, "normal");
  s.orders[0].deadline = 0;
  const w = createWorld(s);
  const r = w.routes[0];
  assert(step(w, { tool: "book_shipment", order: "o0", route: r.id, quantity: 1 }).ok);
  while (w.tick < r.travel) step(w, wait);
  assert.equal(w.orders[0].delivered, 1);
  assert.equal(w.orders[0].onTime, 0);
  assert.equal(verify(w).fulfilled, 0);
  audit(w);
});

test("every benchmark configuration admits a valid delivery schedule", () => {
  for (const [start, count, families] of [[2000000, 12, 5], [3000000, 24, 7]]) {
    for (const { id } of SCENARIOS.slice(0, families)) {
      for (let seed = start; seed < start + count; seed++) {
        const { result } = episode(seed, id, feasiblePlan);
        assert.equal(result.success, true, id + " at seed " + seed);
        assert.deepEqual(result.violations, []);
        assert.equal(result.fulfillmentRate, 1);
        assert.equal(result.rejectedActions, 0);
      }
    }
  }
});

test("independent audit identifies fabricated credits, inventory and financial changes", () => {
  const w = createWorld(makeScenario(192, "normal"));
  while (!w.done) step(w, feasiblePlan(w));
  assert(verify(w).success);
  w.orders[0].onTime--;
  w.warehouses[0].stock++;
  w.budget++;
  w.shipments[1].arrival++;
  const result = verify(w);
  assert.equal(result.success, false);
  assert.deepEqual(result.violations.length, 4);
});

test("terminal worlds cannot be mutated and the finite public menu remains usable", () => {
  const w = createWorld(makeScenario(843, "capacity-cut"));
  assert(availableActions(observe(w)).every((a) => typeof a.tool === "string"));
  while (!w.done) step(w, wait);
  assert.equal(w.tick, w.scenario.horizon);
  const final = snapshot(w);
  assert.equal(step(w, wait).done, true);
  assert.deepEqual(snapshot(w), final);
  assert.deepEqual(availableActions(observe(w)), []);
});

test("named scenarios require a stable seed and an existing grammar", () => {
  for (const seed of [NaN, 0.3, -1, "42", 0x100000000]) assert.throws(() => makeScenario(seed), RangeError);
  assert.throws(() => makeScenario(100, "other"), RangeError);
});

test("the audit detects departures backed only by a later replenishment", () => {
  const scenario = makeScenario(343, "normal");
  const source = scenario.suppliers.find((s) => s.id === scenario.inbound.supplier).warehouse;
  scenario.warehouses.find((w) => w.id === source).stock = 0;
  const w = createWorld(scenario);
  step(w, wait);
  assert(step(w, { tool: "book_shipment", order: "o0", route: source + "-c0", quantity: 1 }).ok);
  const shipment = w.shipments[1];
  while (w.tick < shipment.arrival) step(w, wait);
  audit(w);
  shipment.depart--;
  shipment.arrival--;
  shipment.arrivedAt--;
  assert(verify(w).violations.includes("Insufficient inventory at departure of " + shipment.id + "."));
});

test("budget rejection preserves inventory, reservations, and the carrier's slots", () => {
  const scenario = makeScenario(11, "normal");
  scenario.budget = 1;
  const w = createWorld(scenario);
  const a = { tool: "book_shipment", order: "o0", route: "w0-c0", quantity: 1 };
  const before = snapshot(w);
  assert.match(step(w, a).message, /budget/);
  assert.equal(w.warehouses[0].stock, before.warehouses[0].stock);
  assert.equal(w.budget, before.budget);
  assert.equal(w.routes[0].used, 0);
  assert.equal(w.shipments.length, 1);
  audit(w);
});
