import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTrust, observeTrust, stepTrust, trustCases } from "../docs/lib/trust.js";
import { chooseTrust, trustDecision } from "../docs/lib/trust-policy.js";
import { stochasticPlanner } from "../docs/lib/reserve.js";
import { chooseCloses } from "../docs/lib/closes-policy.js";
import { chooseDrift } from "../docs/lib/drift-policy.js";

const load = async name => JSON.parse(await readFile(new URL("../docs/data/" + name + "/results.json", import.meta.url)));
const [study, closes, drift] = await Promise.all(["trust", "closes", "drift"].map(load));
const experts = { closes: closes.checkpoint.weights, drift: drift.checkpoint.weights };

test("each router executes an available expert's actual call, and learns which side to take on disagreements", () => {
  const { weights, binaryWeights, votesWeights } = study.checkpoint;
  const seen = new Set();
  for (const config of trustCases("validation").slice(0, 128)) {
    const s = createTrust(config);
    let o = observeTrust(s);
    while (!o.done) {
      for (const router of [weights, binaryWeights, votesWeights]) {
        const expertInput = router.specialist ? experts : { closes: experts.closes, get drift() { throw Error("Binary gate used the specialist"); } };
        const result = trustDecision(o, router, expertInput);
        assert.equal(result.action, chooseTrust(o, router, expertInput));
        assert.equal(result.advice.stochastic, stochasticPlanner(o));
        assert.equal(result.advice.closes, chooseCloses(o, experts.closes));
        if (router.specialist) assert.equal(result.advice.drift, chooseDrift(o, experts.drift));
        if (o.slots) assert.deepEqual(result.supporters,
          Object.keys(result.advice).filter(id => result.advice[id] === result.action));
        seen.add(result.status);
        if (result.status === "disagreement") {
          assert.ok(result.supporters.length > 0);
          // Keep the state, advisers and every feature fixed. Changing only
          // the learned return estimate must switch the booking decision.
          for (const [value, expected] of [[1, "accept"], [-1, "pass"]]) {
            const tables = router.tables.map(c => c.map(() => ({ "*": value })));
            assert.equal(chooseTrust(o, { ...router, tables }, expertInput), expected);
          }
        }
      }
      o = stepTrust(s, chooseTrust(o, weights, experts));
    }
    assert.equal(trustDecision(o, weights, experts).action, null);
  }
  assert.deepEqual([...seen].sort(), ["agreement", "capacity", "disagreement"]);
});

test("the released primary and archive checks use the specified noninferiority and superiority bounds", () => {
  const counts = study.routing.all;
  assert.equal(counts.steps, 8 * study.cases.length);
  assert.equal(counts.disagreement + counts.agreement + counts.capacity, counts.steps);
  assert.equal(Object.values(counts.coalitions).reduce((a, b) => a + b, 0), counts.disagreement);
  for (const [key, matches] of Object.entries(counts.onDisagreement)) {
    const matchesByCoalition = Object.entries(counts.coalitions).filter(([group]) => group.split("+").includes(key));
    assert.equal(matchesByCoalition.reduce((n, [, val]) => n + val, 0), matches);
  }
  assert.equal(study.routing.guard.steps, 8 * study.guard.cases.length);
  assert.equal(study.routing.archive.steps, 8 * study.archive.cases.length);
  for (const [candidate, checks] of [["rl", study.checks], ["binary", study.binaryChecks]]) {
    const passes = (g, bounds) => Object.entries(bounds).every(([name, threshold]) =>
      g[candidate + "Minus" + name].interval95[0] > threshold);
    const hot = { Closes: 0, Stochastic: -1 }, reversal = { Closes: -1, Stochastic: 0 };
    assert.equal(checks.hotDrops, passes(study.comparisons.byStratumEnding["interrupted-drop"].hot, hot));
    assert.equal(checks.originalDrop, passes(study.guard.comparisons.all, { Closes: 0, Stochastic: 0, Turns: -1, Drift: -1 }));
    assert.equal(checks.reversals, passes(study.comparisons.byStratum.reversal, reversal));
    assert.equal(checks.archiveHotDrops, passes(study.archive.comparisons.byStratumEnding["interrupted-drop"].hot, hot));
    assert.equal(checks.archiveReversals, passes(study.archive.comparisons.byStratum.reversal, reversal));
    assert.equal(checks.fresh, checks.hotDrops && checks.originalDrop && checks.reversals);
    assert.equal(checks.joint, checks.fresh && checks.archiveHotDrops && checks.archiveReversals);
  }
});
