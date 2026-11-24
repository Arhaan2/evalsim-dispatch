import { availableActions, dispatcher } from "./world.js";

// This post-hoc baseline uses v1's public rules: two yards, four orders and early
// disruptions. Each policy instance remembers only bulletins and its own inspections.
export function createHarborPlanner() {
  const disrupted = new Set();
  const inspected = new Set();
  return (observation) => {
    for (const event of observation.events) {
      if (event.type === "closure" || event.type === "capacity-cut") disrupted.add(event.route);
    }
    const menu = availableActions(observation);
    const wait = menu.find((action) => action.tool === "advance_time");
    if (observation.tick < 2 || observation.shipments.some((load) => !load.order && load.status === "in-transit")) return wait;
    const inspection = menu.find((action) => action.tool === "query_inventory" && !inspected.has(action.warehouse));
    if (inspection) {
      inspected.add(inspection.warehouse);
      return inspection;
    }

    const orders = observation.orders.map((order) => ({
      ...order, remaining: order.demand - order.delivered - order.inTransit,
    })).filter((order) => order.remaining > 0);
    if (!orders.length) return wait;
    let bestAction;
    let lowestCost = Infinity;
    // A bit in the assignment chooses the origin for one full order.
    for (let assignment = 0; assignment < 2 ** orders.length; assignment++) {
      const loads = orders.map((order, index) => {
        const yard = observation.warehouses[(assignment >> index) & 1];
        const route = observation.routes.find((r) => r.customer === order.customer && r.source === yard.id);
        return { order, route, latestDeparture: order.deadline - route.travel };
      });
      if (loads.some(({ order, route }) => disrupted.has(route.id) || order.remaining > route.nominalCapacity)) continue;
      const enoughStock = observation.warehouses.every((yard) => {
        const required = loads.reduce((sum, { order, route }) => sum + (route.source === yard.id ? order.remaining : 0), 0);
        return required <= yard.reportedStock;
      });
      if (!enoughStock) continue;
      const cost = loads.reduce((sum, { order, route }) => sum + order.remaining * route.cost, 0);
      if (cost > observation.budget || cost >= lowestCost) continue;
      loads.sort((a, b) => a.latestDeparture - b.latestDeparture);
      const missesDeadline = loads.some((load, index) =>
        observation.tick + Math.floor((observation.decisions % 4 + index) / 4) > load.latestDeparture);
      if (missesDeadline) continue;
      const { order, route } = loads[0];
      const booking = menu.find((call) => call.tool === "book_shipment" && call.order === order.id
        && call.route === route.id && call.quantity === order.remaining);
      if (booking) {
        bestAction = booking;
        lowestCost = cost;
      }
    }
    return bestAction ?? dispatcher(observation);
  };
}
