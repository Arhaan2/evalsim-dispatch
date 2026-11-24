/** Meridian Harbor. Simulation and operator observations share one event clock. */
export const WORLD_VERSION = "1.0.0";
export const SCENARIOS = [
  { id: "normal", label: "Clear lanes", description: "Fulfill four orders with the opening inventory and freight budget." },
  { id: "route-closure", label: "Route closure", description: "A warehouse loses its direct lane to a customer." },
  { id: "supplier-delay", label: "Supplier delay", description: "A scheduled inbound load misses its original arrival slot." },
  { id: "capacity-cut", label: "Capacity cut", description: "A carrier reduces the number of units it will accept per tick." },
  { id: "demand-surge", label: "Demand surge", description: "A customer doubles an existing commitment during the shift." },
  { id: "compound", label: "Closure + surge", description: "A lane closes and its customer doubles the order." },
  { id: "network-shift", label: "Shifted network", description: "Supplier connections switch, inbound freight is delayed, and a carrier cuts capacity." },
];

export const TOOL_NAMES = [
  "inspect_orders", "query_inventory", "check_supplier_status", "check_transport_capacity",
  "reserve_inventory", "release_inventory", "purchase_inventory", "book_shipment",
  "track_shipment", "advance_time",
];

const CUSTOMERS = ["Market", "Marina", "Heights", "Old Town"];
const DEPOTS = ["West Yard", "East Yard"];
const SOURCES = ["Northworks", "South Pier"];

function generator(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let word = Math.imul(value ^ (value >>> 15), 1 | value);
    word ^= word + Math.imul(word ^ (word >>> 7), 61 | word);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sealed scenario contains the external schedule and one witness route per order.
 * Only the simulator and feasibility auditor may read this object during an episode. */
export function makeScenario(seed, kind = "route-closure") {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("A scenario seed must be an unsigned 32-bit integer.");
  }
  if (!SCENARIOS.some((entry) => entry.id === kind)) throw new RangeError("Unknown scenario: " + kind);
  const random = generator(seed);
  const draw = (low, high) => low + Math.floor(random() * (high - low + 1));
  const target = draw(0, 3);
  const laneLoss = ["route-closure", "compound", "capacity-cut", "network-shift"].includes(kind);
  const delay = ["supplier-delay", "network-shift"].includes(kind);
  const surge = ["demand-surge", "compound"].includes(kind);
  const alternate = draw(0, 1);
  const direct = (i) => (i + alternate) % 2;
  const destinations = CUSTOMERS.map((_, i) => direct(i));
  // Swap this order and a peer to keep a feasible alternate allocation across the two yards.
  if (laneLoss) {
    destinations[target] = 1 - direct(target);
    const peer = (target + (draw(0, 1) ? 1 : 3)) % 4;
    destinations[peer] = 1 - direct(peer);
  }
  const orders = CUSTOMERS.map((name, i) => ({
    id: "o" + i, customer: "c" + i, name,
    demand: draw(kind === "network-shift" ? 7 : 5, kind === "network-shift" ? 11 : 9),
    deadline: draw(7, kind === "network-shift" ? 8 : 9),
  }));
  const finalDemand = orders.map((o, i) => o.demand * (surge && i === target ? 2 : 1));
  const routes = [];
  const capacityMaximum = Math.max(...finalDemand);
  for (let depot = 0; depot < 2; depot++) {
    for (let i = 0; i < orders.length; i++) {
      const preferred = direct(i) === depot;
      routes.push({
        id: "w" + depot + "-c" + i, source: "w" + depot, customer: "c" + i,
        travel: preferred ? draw(1, 2) : draw(2, 3),
        cost: preferred ? 2 : draw(3, 4),
        nominalCapacity: draw(capacityMaximum, capacityMaximum + 4),
      });
    }
  }
  const assigned = orders.map((o, i) => "w" + destinations[i] + "-" + o.customer);
  const supplierIndex = draw(0, 1);
  const suppliers = SOURCES.map((name, i) => ({
    id: "s" + i, name, warehouse: "w" + (kind === "network-shift" ? 1 - i : i),
    eta: draw(1, 2), cost: draw(1, 2), available: draw(8, 15),
  }));
  const inboundSupplier = suppliers[supplierIndex];
  const inboundQuantity = draw(5, 8);
  const warehouses = DEPOTS.map((name, i) => {
    const needed = finalDemand.reduce((sum, q, j) => sum + (destinations[j] === i ? q : 0), 0);
    const opening = needed + draw(0, 2) - (inboundSupplier.warehouse === "w" + i ? inboundQuantity : 0);
    return { id: "w" + i, name, stock: opening, reportedStock: Math.max(0, opening + draw(-3, 5)) };
  });
  const witnessCost = assigned.reduce((sum, id, i) => sum + routes.find((r) => r.id === id).cost * finalDemand[i], 0);
  const schedule = [];
  const affectedRoute = "w" + direct(target) + "-c" + target;
  if (kind === "route-closure" || kind === "compound") {
    schedule.push({ tick: 0, type: "closure", route: affectedRoute });
  }
  if (kind === "capacity-cut" || kind === "network-shift") {
    schedule.push({ tick: 0, type: "capacity-cut", route: affectedRoute, capacity: draw(1, 2) });
  }
  if (delay) schedule.push({ tick: 1, type: "supplier-delay", supplier: inboundSupplier.id, ticks: 2 });
  if (surge) schedule.push({ tick: 2, type: "demand-surge", order: orders[target].id, extra: orders[target].demand });
  return {
    version: WORLD_VERSION, seed, kind, horizon: 10, decisionLimit: 40, budget: witnessCost + draw(3, 12),
    warehouses, suppliers, orders, routes, schedule, witnessRoutes: assigned,
    inbound: { supplier: inboundSupplier.id, quantity: inboundQuantity, arrival: 1 },
  };
}

function log(world, type, message, data = {}) {
  const event = { tick: world.tick, decision: world.decisions, type, message, ...data };
  world.events.push(event);
  return event;
}

function freeStock(world, warehouse) {
  const reserved = world.reservations.filter((r) => r.warehouse === warehouse.id)
    .reduce((sum, r) => sum + r.quantity, 0);
  return warehouse.stock - reserved;
}

function refreshDepot(world, depot) {
  depot.reportedStock = freeStock(world, depot);
  depot.observedAt = world.tick;
}

function refreshRoute(world, route) {
  route.capacity = route.open ? route.capacityLimit - route.used : 0;
  route.reportedOpen = route.open;
  route.observedAt = world.tick;
}

function applyExternal(world) {
  for (const entry of world.scenario.schedule) {
    if (entry.tick !== world.tick) continue;
    if (entry.type === "closure" || entry.type === "capacity-cut") {
      const route = world.routes.find((r) => r.id === entry.route);
      if (entry.type === "closure") route.open = false;
      else route.capacityLimit = entry.capacity;
      // A public bulletin identifies the corridor; direct inspection reveals the current slots.
      const message = entry.type === "closure" ? "Road closure reported" : "Carrier capacity cut reported";
      log(world, entry.type, message + " on " + route.id + ".", { route: route.id });
    } else if (entry.type === "supplier-delay") {
      const supplier = world.suppliers.find((s) => s.id === entry.supplier);
      supplier.actualEta += entry.ticks;
      for (const shipment of world.shipments) {
        if (shipment.source === supplier.id && shipment.status === "in-transit") shipment.arrival += entry.ticks;
      }
      log(world, entry.type, supplier.name + " reports a delay to inbound freight.", { supplier: supplier.id });
    } else if (entry.type === "demand-surge") {
      const order = world.orders.find((o) => o.id === entry.order);
      order.demand += entry.extra;
      log(world, entry.type, order.name + " increases its order to " + order.demand + " units.", { order: order.id });
    }
  }
}

export function createWorld(scenario) {
  const { inbound } = scenario;
  const supplier = scenario.suppliers.find((s) => s.id === inbound.supplier);
  const world = {
    scenario, tick: 0, decisions: 0, done: false, budget: scenario.budget, rejectedActions: 0,
    lastResult: null, events: [], reservations: [],
    warehouses: scenario.warehouses.map((s) => ({ ...s, observedAt: -1 })),
    suppliers: scenario.suppliers.map((s) => ({ ...s, actualEta: s.eta, observedAt: -1 })),
    orders: scenario.orders.map((o) => ({ ...o, delivered: 0, onTime: 0, inTransit: 0 })),
    routes: scenario.routes.map((r) => ({
      ...r, capacityLimit: r.nominalCapacity, capacity: r.nominalCapacity, used: 0,
      open: true, reportedOpen: true, observedAt: -1,
    })),
    shipments: [{
      id: "sh0", source: supplier.id, destination: supplier.warehouse, quantity: inbound.quantity,
      depart: 0, arrival: inbound.arrival, reportedArrival: inbound.arrival, status: "in-transit",
      order: null, route: null, cost: 0, arrivedAt: null,
    }],
  };
  log(world, "opening", "Shift opens with four customer commitments.");
  applyExternal(world);
  return world;
}

function processTick(world) {
  world.tick++;
  for (const route of world.routes) route.used = 0;
  applyExternal(world);
  for (const s of world.shipments) {
    if (s.status !== "in-transit" || s.arrival > world.tick) continue;
    s.status = "delivered";
    s.arrivedAt = world.tick;
    s.reportedArrival = world.tick;
    if (s.order) {
      const order = world.orders.find((o) => o.id === s.order);
      order.inTransit -= s.quantity;
      order.delivered += s.quantity;
      if (world.tick <= order.deadline) order.onTime += s.quantity;
      log(world, "delivery", s.quantity + " units arrived at " + order.name + ".", { shipment: s.id, order: order.id });
    } else {
      const warehouse = world.warehouses.find((w) => w.id === s.destination);
      warehouse.stock += s.quantity;
      log(world, "replenishment", warehouse.name + " received " + s.quantity + " units.", { shipment: s.id, warehouse: warehouse.id });
    }
  }
}

/** The policy sees last-reported stock, capacity and ETA. Authoritative stock and
 * unopened future events are intentionally absent, even after the scenario is saved. */
export function observe(world) {
  const { scenario } = world;
  return {
    tick: world.tick, horizon: scenario.horizon, decisions: world.decisions, decisionLimit: scenario.decisionLimit,
    budget: world.budget, initialBudget: scenario.budget, done: world.done,
    orders: world.orders.map((o) => ({ ...o })),
    warehouses: world.warehouses.map(({ id, name, reportedStock, observedAt }) => ({ id, name, reportedStock, observedAt })),
    suppliers: world.suppliers.map(({ actualEta, ...publicData }) => ({ ...publicData })),
    routes: world.routes.map(({ id, source, customer, travel, cost, nominalCapacity, capacity, reportedOpen, observedAt }) => ({
      id, source, customer, travel, nominalTravel: travel, cost, nominalCapacity, capacity, open: reportedOpen, observedAt,
    })),
    shipments: world.shipments.map(({ reportedArrival, arrival, ...s }) => ({ ...s, arrival: reportedArrival })),
    reservations: world.reservations.map((r) => ({ ...r })),
    lastResult: world.lastResult && { ...world.lastResult, action: { ...world.lastResult.action } },
    events: world.events.slice(-6).map((e) => ({ ...e })),
  };
}

/** Public replay telemetry; never feed this state to an operator. */
export function snapshot(world) {
  const result = observe(world);
  result.seed = world.scenario.seed;
  result.kind = world.scenario.kind;
  result.warehouses = result.warehouses.map((w, i) => ({
    ...w, stock: world.warehouses[i].stock, available: freeStock(world, world.warehouses[i]),
  }));
  result.routes = result.routes.map((r, i) => {
    const route = world.routes[i];
    return { ...r, open: route.open, capacityLimit: route.capacityLimit, remainingCapacity: route.open ? route.capacityLimit - route.used : 0 };
  });
  result.shipments = world.shipments.map((s) => ({ ...s }));
  return result;
}

function freight(world, fields) {
  const shipment = {
    id: "sh" + world.shipments.length, depart: world.tick, status: "in-transit",
    arrivedAt: null, reportedArrival: fields.arrival, ...fields,
  };
  world.shipments.push(shipment);
  world.budget -= shipment.cost;
  return shipment;
}

const good = (message) => ({ ok: true, message });
const bad = (message) => ({ ok: false, message });

function perform(world, a) {
  if (!a || typeof a !== "object") return bad("A typed tool call is required.");
  const order = a.order && world.orders.find((o) => o.id === a.order);
  const route = a.route && world.routes.find((r) => r.id === a.route);
  const warehouseId = a.tool === "book_shipment" && route ? route.source : a.warehouse;
  const warehouse = warehouseId && world.warehouses.find((w) => w.id === warehouseId);
  const supplier = a.supplier && world.suppliers.find((s) => s.id === a.supplier);
  const q = a.quantity;
  if (["purchase_inventory", "reserve_inventory", "release_inventory", "book_shipment"].includes(a.tool)
      && (!Number.isSafeInteger(q) || q <= 0)) return bad("Quantity must be a positive whole number.");
  const hold = warehouse && order && world.reservations.find((r) => r.order === order.id && r.warehouse === warehouse.id);
  switch (a.tool) {
    case "inspect_orders":
      return good(world.orders.length + " commitments on the manifest.");
    case "query_inventory":
      if (!warehouse) return bad("Unknown warehouse.");
      refreshDepot(world, warehouse);
      return good(warehouse.name + " has " + warehouse.reportedStock + " available units.");
    case "check_transport_capacity":
      if (!route) return bad("Unknown route.");
      refreshRoute(world, route);
      return good(route.id + " has " + route.capacity + " units of capacity this tick.");
    case "check_supplier_status":
      if (!supplier) return bad("Unknown supplier.");
      supplier.observedAt = world.tick;
      supplier.eta = supplier.actualEta;
      return good(supplier.name + " quotes " + supplier.eta + " ticks for replenishment.");
    case "track_shipment": {
      const shipment = world.shipments.find((s) => s.id === a.shipment);
      if (!shipment) return bad("Unknown shipment.");
      shipment.reportedArrival = shipment.arrival;
      return good(shipment.id + (shipment.status === "delivered" ? " arrived at tick " : " is due at tick ") + shipment.arrival + ".");
    }
    case "reserve_inventory": {
      if (!order || !warehouse) return bad("Unknown order or warehouse.");
      refreshDepot(world, warehouse);
      const alreadyHeld = world.reservations.filter((r) => r.order === order.id).reduce((n, r) => n + r.quantity, 0);
      if (q > order.demand - order.delivered - order.inTransit - alreadyHeld) return bad("Reservation exceeds unallocated demand.");
      if (q > warehouse.reportedStock) return bad("Insufficient unreserved stock.");
      if (hold) hold.quantity += q;
      else world.reservations.push({ order: order.id, warehouse: warehouse.id, quantity: q });
      refreshDepot(world, warehouse);
      return good(q + " units held at " + warehouse.name + " for " + order.name + ".");
    }
    case "release_inventory":
      if (!hold || q > hold.quantity) return bad("Release exceeds this order's reservation.");
      hold.quantity -= q;
      if (!hold.quantity) world.reservations = world.reservations.filter((r) => r !== hold);
      refreshDepot(world, warehouse);
      return good("Released " + q + " units at " + warehouse.name + ".");
    case "purchase_inventory": {
      if (!supplier) return bad("Unknown supplier.");
      const cost = q * supplier.cost;
      if (q > supplier.available) return bad("Supplier has insufficient units.");
      if (cost > world.budget) return bad("Purchase exceeds the remaining budget.");
      supplier.available -= q;
      supplier.eta = supplier.actualEta;
      supplier.observedAt = world.tick;
      const shipment = freight(world, {
        source: supplier.id, destination: supplier.warehouse, quantity: q, arrival: world.tick + supplier.actualEta,
        order: null, route: null, cost,
      });
      log(world, "purchase", "Ordered " + q + " units from " + supplier.name + ".", { shipment: shipment.id, supplier: supplier.id });
      return good(shipment.id + " will replenish " + supplier.warehouse + " at tick " + shipment.arrival + ".");
    }
    case "book_shipment": {
      if (!order || !route || route.customer !== order.customer) return bad("Route must serve the order's customer.");
      if (q > order.demand - order.delivered - order.inTransit) return bad("Shipment exceeds outstanding demand.");
      refreshRoute(world, route);
      if (!route.open) return bad("Lane closed on " + route.id + ".");
      if (q > route.capacity) return bad("Booking exceeds current carrier capacity.");
      refreshDepot(world, warehouse);
      if (q > warehouse.reportedStock + (hold?.quantity ?? 0)) return bad("Booking exceeds stock available to this order.");
      const cost = q * route.cost;
      if (cost > world.budget) return bad("Booking exceeds the freight budget.");
      // Other depots may hold units for this order. Release only holds made redundant
      // by this dispatch, so no empty commitment can immobilize stock elsewhere.
      if (hold) hold.quantity -= Math.min(q, hold.quantity);
      let unbooked = order.demand - order.delivered - order.inTransit - q;
      for (const reservation of world.reservations) {
        if (reservation.order !== order.id) continue;
        const keep = Math.min(unbooked, reservation.quantity);
        unbooked -= keep;
        reservation.quantity = keep;
      }
      world.reservations = world.reservations.filter((r) => r.quantity > 0);
      warehouse.stock -= q;
      route.used += q;
      order.inTransit += q;
      refreshDepot(world, warehouse);
      refreshRoute(world, route);
      const shipment = freight(world, {
        source: warehouse.id, destination: order.customer, quantity: q, arrival: world.tick + route.travel,
        order: order.id, route: route.id, cost,
      });
      log(world, "booking", warehouse.name + " dispatched " + q + " units to " + order.name + ".", { shipment: shipment.id, route: route.id, order: order.id });
      return good(shipment.id + " booked for " + cost + " credits. ETA tick " + shipment.arrival + ".");
    }
    case "advance_time":
      return good("Advanced the shift by one tick.");
    default:
      return bad("Unknown tool.");
  }
}

export function step(world, action) {
  if (world.done) return { ok: false, message: "The shift has ended.", reward: 0, done: true, events: [] };
  const previousDelivered = world.orders.reduce((n, o) => n + o.onTime, 0);
  const previousBudget = world.budget;
  const startEvents = world.events.length;
  world.decisions++;
  const result = perform(world, action);
  if (!result.ok) world.rejectedActions++;
  world.lastResult = { ...result, tool: action?.tool, action: { ...action } };
  if (action?.tool === "advance_time" || world.decisions % 4 === 0) processTick(world);
  const allDelivered = world.orders.every((o) => o.delivered === o.demand);
  const pendingCommitment = world.scenario.schedule.some((s) => s.type === "demand-surge" && s.tick > world.tick);
  world.done = world.tick >= world.scenario.horizon || world.decisions >= world.scenario.decisionLimit || (allDelivered && !pendingCommitment);
  const onTime = world.orders.reduce((n, o) => n + o.onTime, 0);
  const demand = world.orders.reduce((n, o) => n + o.demand, 0);
  let reward = (onTime - previousDelivered) / demand - 0.005 - (result.ok ? 0 : 0.02)
    - 0.005 * (previousBudget - world.budget) / world.scenario.budget;
  if (world.done && onTime === demand) reward += verify(world).success ? 1 : 0;
  return { ...result, reward, done: world.done, events: world.events.slice(startEvents).map((e) => ({ ...e })) };
}

/** Audit physical arrivals and the booking ledger independently of reward or dispatcher logic. */
export function verify(world) {
  const { scenario } = world;
  const violations = [];
  const record = (condition, message) => { if (!condition) violations.push(message); };
  const stock = new Map(scenario.warehouses.map((w) => [w.id, w.stock]));
  const supply = new Map(scenario.suppliers.map((s) => [s.id, s.available]));
  const auditedOrders = new Map(scenario.orders.map((o) => [o.id, {
    ...o, delivered: 0, onTime: 0, inTransit: 0,
  }]));
  const laneUsage = new Map();
  const flows = new Map();
  const timeline = (tick) => {
    if (!flows.has(tick)) flows.set(tick, { receipts: [], dispatches: [] });
    return flows.get(tick);
  };
  const seen = new Set();
  const occurred = scenario.schedule.filter((e) => e.tick <= world.tick);
  const arrivals = [];
  for (const e of occurred) {
    if (e.type === "demand-surge") auditedOrders.get(e.order).demand += e.extra;
  }
  let spend = 0;
  for (const s of world.shipments) {
    record(!seen.has(s.id), "Duplicate shipment ID " + s.id + ".");
    seen.add(s.id);
    if (!Number.isSafeInteger(s.quantity) || s.quantity <= 0) {
      violations.push("Invalid quantity on " + s.id + ".");
      continue;
    }
    record(Number.isInteger(s.depart) && s.depart >= 0 && s.depart <= world.tick, "Invalid departure on " + s.id + ".");
    let expectedCost = 0;
    let arrival;
    if (s.order !== null) {
      const route = scenario.routes.find((r) => r.id === s.route);
      const order = auditedOrders.get(s.order);
      if (!route || !order || route.source !== s.source || route.customer !== s.destination || order.customer !== s.destination) {
        violations.push("Shipment " + s.id + " has an invalid itinerary.");
        continue;
      }
      expectedCost = route.cost * s.quantity;
      arrival = s.depart + route.travel;
      timeline(s.depart).dispatches.push(s);
      stock.set(s.source, stock.get(s.source) - s.quantity);
      const key = route.id + "@" + s.depart;
      const booked = (laneUsage.get(key) ?? 0) + s.quantity;
      laneUsage.set(key, booked);
      let capacity = route.nominalCapacity;
      for (const e of occurred) {
        if (e.route !== route.id || e.tick > s.depart) continue;
        if (e.type === "closure") capacity = 0;
        if (e.type === "capacity-cut") capacity = e.capacity;
      }
      record(booked <= capacity, "Capacity exceeded on " + key + ".");
      if (arrival <= world.tick) {
        order.delivered += s.quantity;
        if (arrival <= order.deadline) order.onTime += s.quantity;
      } else order.inTransit += s.quantity;
    } else {
      const supplier = scenario.suppliers.find((p) => p.id === s.source);
      if (!supplier || supplier.warehouse !== s.destination) {
        violations.push("Inbound " + s.id + " has an invalid itinerary.");
        continue;
      }
      if (s.id === "sh0") {
        record(s.source === scenario.inbound.supplier && s.quantity === scenario.inbound.quantity && s.depart === 0,
          "Opening inbound freight differs from the manifest.");
        arrival = scenario.inbound.arrival;
      } else {
        supply.set(s.source, supply.get(s.source) - s.quantity);
        expectedCost = supplier.cost * s.quantity;
        arrival = s.depart + supplier.eta;
      }
      for (const e of occurred) {
        if (e.type === "supplier-delay" && e.supplier === supplier.id && arrival >= e.tick) arrival += e.ticks;
      }
      if (arrival <= world.tick) {
        stock.set(s.destination, stock.get(s.destination) + s.quantity);
        timeline(arrival).receipts.push(s);
      }
    }
    const delivered = arrival <= world.tick;
    record(s.arrival === arrival && s.arrivedAt === (delivered ? arrival : null)
      && s.status === (delivered ? "delivered" : "in-transit"), "Arrival ledger mismatch on " + s.id + ".");
    record(s.cost === expectedCost, "Freight charge mismatch on " + s.id + ".");
    if (delivered) arrivals.push(s.id);
    spend += expectedCost;
  }
  record(seen.has("sh0"), "Opening inbound freight is missing.");
  record(world.budget === scenario.budget - spend && world.budget >= 0, "Freight budget does not reconcile.");
  // A balanced closing ledger can still hide a dispatch made before its inventory
  // arrived, or goods shipped against demand that had not yet been placed.
  const openingStock = new Map(scenario.warehouses.map((w) => [w.id, w.stock]));
  const openDemand = new Map(scenario.orders.map((o) => [o.id, o.demand]));
  for (let tick = 0; tick <= world.tick; tick++) {
    for (const e of occurred) {
      if (e.tick === tick && e.type === "demand-surge") openDemand.set(e.order, openDemand.get(e.order) + e.extra);
    }
    const movement = flows.get(tick);
    if (!movement) continue;
    for (const receipt of movement.receipts) {
      openingStock.set(receipt.destination, openingStock.get(receipt.destination) + receipt.quantity);
    }
    for (const shipment of movement.dispatches) {
      const remaining = openingStock.get(shipment.source) - shipment.quantity;
      const demand = openDemand.get(shipment.order) - shipment.quantity;
      record(remaining >= 0, "Insufficient inventory at departure of " + shipment.id + ".");
      record(demand >= 0, "Uncommitted demand at departure of " + shipment.id + ".");
      openingStock.set(shipment.source, remaining);
      openDemand.set(shipment.order, demand);
    }
  }
  record(world.warehouses.length === stock.size && new Set(world.warehouses.map((w) => w.id)).size === stock.size,
    "Warehouse ledger differs from the manifest.");
  record(world.orders.length === auditedOrders.size && new Set(world.orders.map((o) => o.id)).size === auditedOrders.size,
    "Order ledger differs from the manifest.");
  for (const warehouse of world.warehouses) {
    const available = freeStock(world, warehouse);
    record(warehouse.stock === stock.get(warehouse.id) && warehouse.stock >= 0 && available >= 0,
      "Inventory does not reconcile at " + warehouse.id + ".");
  }
  for (const supplier of world.suppliers) {
    record(supply.get(supplier.id) === supplier.available && supplier.available >= 0, "Supplier stock mismatch at " + supplier.id + ".");
  }
  for (const hold of world.reservations) {
    record(Number.isSafeInteger(hold.quantity) && hold.quantity > 0 && stock.has(hold.warehouse) && auditedOrders.has(hold.order),
      "Invalid reservation in ledger.");
  }
  let fulfilled = 0;
  let totalDemand = 0;
  let ordersOnTime = 0;
  let delivered = 0;
  for (const order of auditedOrders.values()) {
    const counter = world.orders.find((o) => o.id === order.id);
    const held = world.reservations.filter((r) => r.order === order.id).reduce((sum, r) => sum + r.quantity, 0);
    record(counter && counter.demand === order.demand && counter.delivered === order.delivered
      && counter.onTime === order.onTime && counter.inTransit === order.inTransit
      && order.inTransit + order.delivered + held <= order.demand, "Commitment mismatch at " + order.id + ".");
    totalDemand += order.demand;
    delivered += order.delivered;
    fulfilled += order.onTime;
    if (order.onTime === order.demand) ordersOnTime++;
  }
  const pendingCommitment = scenario.schedule.some((e) => e.type === "demand-surge" && e.tick > world.tick);
  const terminal = world.tick >= scenario.horizon || world.decisions >= scenario.decisionLimit
    || (delivered === totalDemand && !pendingCommitment);
  record(world.done === terminal, "Terminal status differs from the shift ledger.");
  return {
    success: world.done && fulfilled === totalDemand && violations.length === 0,
    fulfilled, delivered, totalDemand, fulfillmentRate: fulfilled / totalDemand, ordersOnTime,
    spend, budgetRemaining: world.budget, violations, toolCalls: world.decisions,
    rejectedActions: world.rejectedActions, arrivals, done: world.done,
  };
}

/** Finite action menu shared by stochastic and deterministic operators. Everything
 * here can be computed from the public observation; stale reports can produce a rejection. */
export function availableActions(obs) {
  if (obs.done) return [];
  const actions = [];
  for (const order of obs.orders) {
    const outstanding = order.demand - order.delivered - order.inTransit;
    if (outstanding <= 0) continue;
    for (const route of obs.routes) {
      if (route.customer !== order.customer || !route.open) continue;
      const depot = obs.warehouses.find((w) => w.id === route.source);
      const held = obs.reservations.find((r) => r.order === order.id && r.warehouse === route.source)?.quantity ?? 0;
      // A fresh tick resets booking slots; a check is needed to resolve a stale zero.
      const capacity = route.observedAt === obs.tick ? route.capacity : route.nominalCapacity;
      const q = Math.min(outstanding, depot.reportedStock + held, capacity, Math.floor(obs.budget / route.cost));
      if (q > 0) actions.push({ tool: "book_shipment", order: order.id, route: route.id, quantity: q });
      if (route.observedAt < obs.tick && (route.capacity < route.nominalCapacity
          || obs.events.some((e) => e.route === route.id && ["closure", "capacity-cut"].includes(e.type)))) {
        actions.push({ tool: "check_transport_capacity", route: route.id });
      }
    }
  }
  const totalUnbooked = obs.orders.reduce((sum, o) => sum + o.demand - o.delivered - o.inTransit, 0);
  if (totalUnbooked > 0) {
    for (const w of obs.warehouses) {
      if (w.observedAt < obs.tick) actions.push({ tool: "query_inventory", warehouse: w.id });
    }
    for (const s of obs.suppliers) {
      const yard = obs.warehouses.find((w) => w.id === s.warehouse);
      const inbound = obs.shipments.filter((f) => f.destination === yard.id && f.status === "in-transit")
        .reduce((sum, f) => sum + f.quantity, 0);
      const quantity = Math.min(s.available, 5, Math.floor(obs.budget / s.cost), totalUnbooked - yard.reportedStock - inbound);
      if (quantity > 0 && obs.tick + s.eta < obs.horizon) {
        actions.push({ tool: "purchase_inventory", supplier: s.id, quantity });
        if (s.observedAt < 0) actions.push({ tool: "check_supplier_status", supplier: s.id });
      }
    }
  }
  actions.push({ tool: "advance_time" });
  return actions;
}

export const enumerateActions = availableActions;

/** Hand-written baseline. Earliest deadline first, then full loads and cheap lanes.
 * Reinspect a stale yard before spending on additional stock. */
export function dispatcher(obs) {
  const actions = availableActions(obs);
  const bookings = actions.filter((a) => a.tool === "book_shipment").map((action) => {
    const order = obs.orders.find((o) => o.id === action.order);
    const route = obs.routes.find((r) => r.id === action.route);
    const knownClosure = obs.events.some((e) => e.type === "closure" && e.route === route.id);
    const useful = obs.tick + route.travel <= order.deadline && !knownClosure;
    return { action, order, route, useful, full: action.quantity + order.delivered + order.inTransit === order.demand };
  }).filter((b) => b.useful);
  bookings.sort((a, b) => a.order.deadline - b.order.deadline || Number(b.full) - Number(a.full)
    || a.route.cost - b.route.cost || b.action.quantity - a.action.quantity || a.route.travel - b.route.travel);
  if (bookings.length) return bookings[0].action;
  const discovery = actions.find((a) => a.tool === "query_inventory" &&
    !obs.warehouses.some((w) => w.id === a.warehouse && w.reportedStock === 0 && w.observedAt >= 0 &&
    !obs.events.some((e) => e.type === "replenishment" && e.warehouse === w.id && e.tick >= w.observedAt)));
  if (discovery) return discovery;
  if (!obs.shipments.some((s) => s.status === "in-transit" && !s.order)) {
    const purchase = actions.find((a) => a.tool === "purchase_inventory" &&
      obs.budget >= a.quantity * (2 + obs.suppliers.find((s) => s.id === a.supplier).cost));
    if (purchase) return purchase;
  }
  return { tool: "advance_time" };
}

/** Omniscient constructive feasibility witness. Never use this as the operator. */
export function feasiblePlan(world) {
  if (world.done) return null;
  // By tick three, all shocks have occurred and the prepaid load has reached its yard.
  if (world.tick < 3) return { tool: "advance_time" };
  for (let i = 0; i < world.orders.length; i++) {
    const order = world.orders[i];
    const quantity = order.demand - order.inTransit - order.delivered;
    if (quantity > 0) return { tool: "book_shipment", route: world.scenario.witnessRoutes[i], order: order.id, quantity };
  }
  return { tool: "advance_time" };
}
