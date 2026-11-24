import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLOSES_PATTERNS, closesCases, createCloses, stepCloses } from "../docs/lib/closes.js";
import { closesThreshold, extendClosesHistory, publicClosesKeys } from "../docs/lib/closes-policy.js";
import { pairedReserve } from "../docs/lib/reserve-policy.js";

const release = JSON.parse(await readFile(new URL("../docs/data/closes/results.json", import.meta.url)));

test("the ablation consumes the same complete posted board and is blind to earlier outcomes and quotes", () => {
  const state = createCloses(closesCases("validation")[0]);
  const o = stepCloses(state, "pass");
  const keys = publicClosesKeys(o);
  const differentForecast = structuredClone(o);
  differentForecast.forecast.at(-1).highChance = 0.855;
  assert.notDeepEqual(publicClosesKeys(differentForecast), keys);
  const differentPrices = structuredClone(o);
  differentPrices.forecast[0].high++;
  assert.notDeepEqual(publicClosesKeys(differentPrices), keys);
  const changed = structuredClone(o);
  const first = changed.history[0];
  first.high = !first.high;
  first.offer.net = first.high ? first.quote.high : first.quote.low;
  first.offer.revenue = first.offer.cost + first.offer.net;
  first.quote.highChance = 0.2;
  assert.deepEqual(publicClosesKeys(changed), keys);
  assert.equal(closesThreshold(o, release.checkpoint.ablatedWeights), closesThreshold(changed, release.checkpoint.ablatedWeights));
  const full = [...keys];
  extendClosesHistory(full, changed.history);
  assert.deepEqual(full.slice(0, keys.length), keys);
  assert.notDeepEqual(full, keys);
  assert.equal(release.checkpoint.weights.history, true);
  assert.equal(release.checkpoint.ablatedWeights.history, false);
});

test("all primary paired comparisons use the frozen cases and archived retention is checked per family", () => {
  const { cases, guard, checks, comparisons, protocol } = release;
  for (const [rows, split] of [[cases, "test"], [guard.cases, "retention"]]) {
    assert.deepEqual(rows.map(({ family, seed }) => ({ family, seed })),
      closesCases(split).map(({ family, seed }) => ({ family, seed })));
  }
  const score = (rows, key) => pairedReserve(rows, "rl", key);
  const keep = rows => score(rows, "stochastic").interval95[0] > 0 &&
    ["turns", "drift"].every(key => score(rows, key).interval95[0] > -protocol.retentionMargin);
  const reversals = cases.filter(row => CLOSES_PATTERNS[row.family].stratum === "reversal");
  const drops = cases.filter(row => CLOSES_PATTERNS[row.family].stratum === "interrupted-drop");
  assert.deepEqual(comparisons.byStratum.reversal.rlMinusStochastic, score(reversals, "stochastic"));
  assert.deepEqual(comparisons.byStratum.reversal.rlMinusAblated, score(reversals, "ablated"));
  for (const [stratum, rows] of [["reversal", reversals], ["interrupted-drop", drops]]) {
    for (const ending of ["hot", "cold"]) {
      const subset = rows.filter(row => CLOSES_PATTERNS[row.family].ending === ending);
      assert.equal(subset.length * 2, rows.length);
      assert.deepEqual(comparisons.byStratumEnding[stratum][ending].rlMinusStochastic, score(subset, "stochastic"));
    }
  }
  const guardRetention = Object.fromEntries(release.suite.splits.retention.families.map(family =>
    [family, keep(guard.cases.filter(row => row.family === family))]));
  const reversalPlanner = score(reversals, "stochastic").interval95[0] > 0;
  const reversalHistory = score(reversals, "ablated").interval95[0] > 0;
  const freshDropRetention = keep(drops);
  assert.deepEqual(checks, { reversalPlanner, reversalHistory, freshDropRetention, guardRetention,
    joint: reversalPlanner && reversalHistory && freshDropRetention && Object.values(guardRetention).every(Boolean) });
});
