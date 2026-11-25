import assert from "node:assert/strict";
import test from "node:test";
import { createFleetWeek, FLEET_DEPOTS, FLEET_FAMILIES, FLEET_PATTERNS, fleetWeekActions,
  fleetWeekBoardScenarios, runFleetWeek } from "../docs/lib/fleetweek.js";
import { chooseFleetPlanner, chooseFleetGreedy, fleetWeekHubProjection } from "../docs/lib/fleetweek-planner.js";

const config = { family: "eastbound", seed: 301 };
const wait = () => "W|W";
const distances = [[0, 20, 32], [20, 0, 26], [32, 26, 0]];

test("five days preserve both indexed truck locations and reject bad actions without advancing", () => {
  const week = createFleetWeek(config);
  assert.deepEqual(FLEET_DEPOTS, ["Harbor", "Inland", "Junction"]);
  assert.deepEqual(week.observe().positions, [0, 1]);
  const first = week.legalActions().find(a => a.id === "E2|W");
  assert.deepEqual(first.positions, [2, 1]);
  const before = week.ledger;
  assert.throws(() => week.step("X|W"), /Illegal fleet action/);
  assert.equal(week.ledger, before);
  week.step(first.id);
  assert.deepEqual(week.observe().positions, first.positions);
  assert.equal(week.observe().period, "PM");
  week.step("W|W");
  assert.equal(week.observe().day, 2);
  assert.deepEqual(week.observe().positions, [2, 1]);
  while (!week.done) week.step("W|W");
  assert.equal(week.observe(), null);
  assert.deepEqual(week.legalActions(), []);
  assert.equal(week.ledger.contracts, 10);
  assert.equal(week.ledger.emptyMiles, 32);
  assert.equal(week.ledger.emptyCost, 19);
  assert.equal(week.ledger.net, -359);
  assert.throws(() => week.step("W|W"), /complete/);
});

test("all board menus conserve freight and reconstruct exactly from serialized public observations", () => {
  for (let phase = 0; phase < 2; phase++) {
    const boards = fleetWeekBoardScenarios(phase);
    assert.equal(boards.length, 18);
    for (let hub = 0; hub < 3; hub++) {
      const weights = boards.filter(board => board.hub === hub).reduce((sum, board) => sum + board.weight, 0);
      assert(Math.abs(1 - weights) < 1e-12);
    }
    for (const { orders } of boards) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const positions = [a, b];
      const menu = fleetWeekActions({ positions, orders });
      assert.deepEqual(menu, fleetWeekActions(JSON.parse(JSON.stringify({ positions, orders }))));
      assert.equal(new Set(menu.map(action => action.id)).size, menu.length);
      for (const action of menu) {
        let gross = 0, emptyCost = 0, loadedCost = 0, emptyMiles = 0;
        const used = new Set();
        action.moves.forEach((move, truck) => {
          const from = positions[truck], to = action.positions[truck];
          if (move === "W") assert.equal(to, from);
          else if (move.startsWith("E")) {
            assert.notEqual(from, to);
            assert.equal(move, "E" + to);
            emptyMiles += distances[from][to];
            emptyCost += Math.round(0.6 * distances[from][to]);
          } else {
            assert(!used.has(move)); used.add(move);
            const order = orders.find(o => o.id === move);
            assert.equal(order.origin, from); assert.equal(order.destination, to);
            gross += order.revenue; loadedCost += Math.round(0.45 * distances[from][to]);
          }
        });
        const penalty = used.has("C") ? 0 : 34;
        assert.deepEqual([action.gross, action.loadedCost, action.emptyCost, action.emptyMiles, action.penalty,
          action.net, action.served], [gross, loadedCost, emptyCost, emptyMiles, penalty,
          gross - loadedCost - emptyCost - penalty, used.has("C") ? 1 : 0]);
      }
    }
  }
});

test("held-out demand center schedules are structurally disjoint even after depot renaming", () => {
  const canonical = pattern => {
    const names = new Map(); return [...pattern].map(symbol => {
      if (!names.has(symbol)) names.set(symbol, names.size);
      return names.get(symbol);
    }).join("");
  };
  const all = [...FLEET_FAMILIES.train, ...FLEET_FAMILIES.validation, ...FLEET_FAMILIES.test];
  assert.equal(new Set(all).size, all.length);
  const abstract = all.map(family => {
    assert.match(FLEET_PATTERNS[family], /^[0-2]{10}$/);
    return canonical(FLEET_PATTERNS[family]);
  });
  assert.equal(new Set(abstract).size, abstract.length);
});

test("identical exogenous boards follow different policies; each sees only public current and past records", () => {
  const standby = runFleetWeek(config, wait);
  const busy = runFleetWeek(config, chooseFleetGreedy);
  assert.deepEqual(standby, runFleetWeek(config, wait));
  assert.equal(standby.trace.length, 10);
  assert.notDeepEqual(standby.ledger, busy.ledger);
  standby.trace.forEach(({ observation: a }, i) => {
    const b = busy.trace[i].observation;
    assert.deepEqual(a.orders, b.orders);
    assert.deepEqual(a.forecast, b.forecast);
    assert.deepEqual(a.history, b.history);
    assert.equal(a.history.length, i);
    assert.deepEqual(Object.keys(a).sort(), ["day", "epoch", "forecast", "history", "hub", "orders", "period", "positions"]);
    assert.throws(() => { a.forecast[0][0] = 1; }, TypeError);
    assert.throws(() => { a.orders[0].revenue++; }, TypeError);
  });
  assert.throws(() => createFleetWeek({ ...config, seed: -1 }), /unsigned/);
  assert.throws(() => createFleetWeek({ ...config, seed: 2 ** 32 }), /unsigned/);
  assert.throws(() => createFleetWeek({ ...config, family: "constructor" }), /Unknown/);
});

test("planner posterior agrees with explicit enumeration of the 59,049 possible latent center paths", () => {
  const observation = runFleetWeek(config, wait).trace[4].observation;
  const sums = Array.from({length: 10}, () => [0, 0, 0]);
  const hubs = [...observation.history.map(frame => frame.hub), observation.hub];
  function visit(path, mass) {
    const t = path.length;
    if (t === 10) {path.forEach((d, idx) => { sums[idx][d] += mass; }); return;}
    for (let d = 0; d < 3; d++) {
      const transition = t === 0 ? 1 / 3 : d === path[t - 1] ? 0.65 : 0.175;
      let emission = observation.forecast[t][d];
      if (t < hubs.length) emission *= 0.11 / 3 + (hubs[t] === d ? (t === 0 ? 0.89 : 0.68) : 0)
          + (t > 0 && hubs[t] === hubs[t - 1] ? 0.21 : 0);
      visit([...path, d], mass * transition * emission);
    }
  }
  visit([], 1);
  const inferred = fleetWeekHubProjection(observation);
  for (let t = 0; t < 10; t++) for (let d = 0; d < 3; d++) {
    assert(Math.abs(inferred[t][d] - sums[t][d] / sums[t].reduce((a, b) => a + b)) < 1e-10);
  }
});

test("final two-epoch decisions match a direct exhaustive public forecast planner", () => {
  let different = 0;
  for (let seed = 0; seed < 16; seed++) {
    const trace = runFleetWeek({ ...config, seed }, wait).trace;
    const nextHubs = fleetWeekHubProjection(trace[8].observation)[9];
    for (const positions of [[0, 1], [1, 1], [0, 2], [1, 2]]) {
      const obs = { ...trace[8].observation, positions }, menu = fleetWeekActions(obs);
      function direct(a) {
        let total = a.net;
        for (const board of fleetWeekBoardScenarios(9)) {
          const chance = 0.11 / 3 + 0.68 * nextHubs[board.hub] + (board.hub === obs.hub ? 0.21 : 0);
          const legal = fleetWeekActions({ positions: a.positions, orders: board.orders });
          total += board.weight * chance * Math.max(...legal.map(b => b.net));
        }
        return total;
      }
      const id = chooseFleetPlanner(obs, menu);
      const expected = Math.max(...menu.map(direct));
      assert(Math.abs(expected - direct(menu.find(a => a.id === id))) < 1e-9);
      if (id !== chooseFleetGreedy(obs, menu)) different++;
    }
    const friday = trace[9].observation;
    assert.equal(chooseFleetPlanner(friday), chooseFleetGreedy(friday));
  }
  assert(different > 0, "Future value should change at least one fleet dispatch.");
});
