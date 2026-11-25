import test from "node:test";
import assert from "node:assert/strict";
import { chooseFleetRL, fleetFeatures, fleetPairIndex, FLEET_PAIRS } from "../docs/lib/fleetweek-policy.js";
import { fitAfterstateValues } from "../training/fleetweek/fit.mjs";

const forecast = Array.from({length: 10}, () => [0.2, 0.3, 0.5]);
const board = day => ({epoch: day, hub: 2, forecast, history: []});
const offers = [
  {id:"stay", net:2, positions:[0,0]},
  {id:"send", net:-3, positions:[1,0]},
];

test("afterstate backups learn to pay for position before a future contract", () => {
  // A three-board fixture. Only the final board pays 20 when a truck has
  // already arrived at depot 1. No trainer receives a future tape at inference.
  const stages = 3, weeks = 8, pairs = 6;
  const rewards = new Float64Array(weeks * stages * pairs * pairs).fill(-Infinity);
  const features = new Float64Array(weeks * stages).fill(1);
  for (let w = 0; w < weeks; w++) for (let t = 0; t < stages; t++) {
    for (let p = 0; p < pairs; p++) {
      const reward = t === 2 && FLEET_PAIRS[p].includes(1) ? 20 : 0;
      rewards[((w * stages + t) * pairs + p) * pairs + p] = reward;
    }
  }
  const weights = fitAfterstateValues({features, rewards, weeks, stages, dimension:1});
  // Lift the intercept-only fixture to the deployed feature basis.
  const dimension = fleetFeatures(board(0)).length;
  for (const rows of weights) if (rows) for (const row of rows) {
    row.push(...new Array(dimension - 1).fill(0));
  }
  assert.equal(weights[0][1][0] - weights[0][0][0], 20);
  assert.equal(chooseFleetRL(board(0), offers, {weights}), "send");
  assert.equal(chooseFleetRL(board(2), offers, {weights}), "stay");
});

test("released features use only the published hub history and forecast", () => {
  const o = {...board(2), history:[{hub:1},{hub:0}]};
  const x = fleetFeatures(o);
  assert.deepEqual(fleetFeatures({...o, seed:123, family:"not-public", futureHub:1, positions:[1,2]}), x);
  assert.notDeepEqual(fleetFeatures({...o, history:[{hub:0},{hub:2}]}), x);
  for (let i = 0; i < FLEET_PAIRS.length; i++) {
    assert.equal(fleetPairIndex([...FLEET_PAIRS[i]].reverse()), i);
  }
});
