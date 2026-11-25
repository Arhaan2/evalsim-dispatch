// Check the published trajectories and statistics separately from the experiment's scorer.
// The environment supplies only the exogenous public boards. This checker accounts for both
// named trucks, their locations, costs, expired contracts and gross revenue itself.
import assert from "node:assert/strict";
import { createFleetWeek, fleetWeekActions } from "../../docs/lib/fleetweek.js";

const distances = [[0, 20, 32], [20, 0, 26], [32, 26, 0]];
const columns = ["gross", "loadedCost", "emptyCost", "penalty", "served", "contracts", "emptyMiles", "net"];

export function publicFrames(config) {
  const sim = createFleetWeek(config), frames = [];
  for (let turn = 0; turn < 10; turn++) {
    assert(!sim.done);
    frames.push(sim.observe());
    sim.step("W|W");
  }
  assert(sim.done);
  return frames;
}

export function replay(frames, decide, record) {
  let locations = [0, 1];
  const totals = Object.fromEntries(columns.map(key => [key, 0]));
  if (record) assert.equal(record.actions.length, frames.length);
  for (const [step, frame] of frames.entries()) {
    const observation = { ...frame, positions: locations };
    const id = decide(observation, fleetWeekActions(observation));
    if (record) assert.equal(id, record.actions[step], "Checkpoint or baseline action differs.");
    const moves = id.split("|");
    assert.equal(moves.length, 2);
    const assigned = new Set();
    locations = moves.map((move, truck) => {
      const origin = locations[truck];
      if (move === "W") return origin;
      if (/^E[012]$/.test(move)) {
        const destination = Number(move[1]);
        assert.notEqual(origin, destination);
        const miles = distances[origin][destination];
        totals.emptyMiles += miles;
        totals.emptyCost += Math.round(miles * 0.60);
        return destination;
      }
      assert(!assigned.has(move), "A signed load can only be delivered once.");
      assigned.add(move);
      const order = frame.orders.find(o => o.id === move);
      assert(order && order.origin === origin, "Assigned truck could not reach this offer.");
      const cost = Math.round(distances[origin][order.destination] * 0.45);
      assert.equal(order.loadedCost, cost);
      totals.loadedCost += cost;
      totals.gross += order.revenue;
      return order.destination;
    });
    totals.contracts++;
    if (assigned.has("C")) totals.served++;
    else totals.penalty += 34;
  }
  totals.net = totals.gross - totals.emptyCost - totals.loadedCost - totals.penalty;
  if (record) assert.deepEqual(totals, record.ledger);
  return totals;
}

export function paired(rows, reference) {
  const groups = new Map();
  let profit = 0, service = 0, wins = 0, losses = 0;
  for (const { family, agent, ...others } of rows) {
    const net = agent.net - others[reference].net;
    const served = 10 * (agent.served - others[reference].served);
    profit += net; service += served;
    wins += Number(net > 0); losses += Number(net < 0);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push([net, served]);
  }
  const netBootstrap = [], serviceBootstrap = [];
  let state = 9713;
  for (let trial = 0; trial < 2000; trial++) {
    let n = 0, s = 0;
    for (const stratum of groups.values()) for (let i = 0; i < stratum.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const draw = stratum[Math.floor(stratum.length * (state / 2 ** 32))];
      n += draw[0]; s += draw[1];
    }
    netBootstrap.push(n / rows.length); serviceBootstrap.push(s / rows.length);
  }
  function interval(values) {
    values.sort((a, b) => a - b);
    return [values[49], values[1950]];
  }
  return { net: profit / rows.length, servicePP: service / rows.length, net95: interval(netBootstrap),
    service95: interval(serviceBootstrap), wins, losses, ties: rows.length - wins - losses };
}

export function average(rows, who) {
  const stats = Object.fromEntries(columns.map(k => [k, 0]));
  let targetWeeks = 0;
  for (const row of rows) {
    for (const key of columns) stats[key] += row[who][key];
    targetWeeks += Number(row[who].served >= 7);
  }
  for (const key of columns) stats[key] /= rows.length;
  return { ...stats, onTime: 10 * stats.served, targetWeeks };
}
