import assert from "node:assert/strict";
import test from "node:test";
import {addGuardDecision, addGuardProposal, guardEstimates, guardFeatures, guardRisk} from "../docs/lib/addguard-policy.js";
import {switchCostDecision, switchCostProposal} from "../docs/lib/switchcost-policy.js";
import {closureActions, closureFrames} from "../docs/lib/closure-world.js";
import {closureFrame} from "../docs/lib/closure-planner.js";
import {FLEET_PAIRS} from "../docs/lib/fleetweek.js";
import {selectCandidate, weights} from "../training/addguard/fit.mjs";

test("A veto needs a genuine parent addition and a risk strictly above its cut", () => {
  const heads = {loss:[.7], win:[.2], downside:[20], upside:[3], service:[-.1]};
  const calibration = Object.fromEntries(Object.entries(heads).map(([name, [value]]) =>
    [name, {mean:value, predictedMean:value, slope:1}]));
  const model = {center:[0], scale:[1], heads, calibration, settings:{above:0}};
  const p = {guardX:[1], guardEligible:true, parent:{chosenId:"long", shortId:"short", longId:"long"}};
  const risk = guardRisk(guardEstimates(p.guardX, model));
  assert.equal(addGuardDecision(p, model).chosenId, "short");
  assert.equal(addGuardDecision(p, {...model, settings:{above:risk}}).chosenId, "long");
  assert.equal(addGuardDecision(p, {...model, settings:{above:null}}).chosenId, "long");
  const unaffected = addGuardDecision({...p, guardX:null, guardEligible:false}, model);
  assert.equal(unaffected.guardRisk, null);
  assert.equal(unaffected.chosenId, "long");
  const flat = guardEstimates([1], {...model, heads:{}}, {flatGate:true});
  assert.deepEqual(flat, {loss:.7, win:.2, downside:20, upside:3, service:-.1});
});

test("Selection retains profitable catches and service and resolves equal savings towards the narrower veto", () => {
  const result = (fraction, fields = {}) => ({settings:{fraction, above:fraction ? 1 / fraction : null},
    lossesAvoided:3, winsForgone:0, savings:75, netParent:40, serviceParent:0, serviceShort:5, ...fields});
  const fallback = result(0, {lossesAvoided:0, savings:0, netParent:0});
  const failures = [result(.01, {winsForgone:1}), result(.025, {serviceParent:-1}), result(.05, {netParent:0}),
    result(.1, {savings:0}), result(.2, {serviceShort:-1})];
  assert.deepEqual(selectCandidate([fallback, ...failures]), {settings:fallback.settings, feasible:0});
  assert.deepEqual(selectCandidate([fallback, result(.2), result(.1), result(.35, {lossesAvoided:2, savings:150})]),
    {settings:result(.1).settings, feasible:3});
});

test("Guard inputs describe paired alternatives only on frozen fit 73 additions", () => {
  const seed = 1100000000, family = "steady-market", closure = {starts:[2, 4, 6], durations:[1, 2, 3, 4, 4, 5, 5]};
  let sawTarget = false, offTarget = 0;
  for (let i = 0; i < 1024 && !sawTarget; i++) {
    for (const obs of closureFrames({seed:seed + i, family, closure})) {
      if (obs.epoch === 9 || !["closed", "warning"].includes(obs.incident.status)) continue;
      const f = closureFrame(obs);
      for (const positions of FLEET_PAIRS) {
        const menu = closureActions({...obs, positions});
        const parent = switchCostDecision(switchCostProposal(f, menu, weights), weights.parent);
        const p = addGuardProposal(f, menu, weights);
        assert.deepEqual(p.parent, parent);
        assert.equal(p.guardEligible, parent.added);
        if (!parent.added) { assert.equal(p.guardX, null); offTarget++; continue; }
        sawTarget = true;
        assert.equal(p.guardX.length, guardFeatures.length);
        assert(p.guardX.every(Number.isFinite));
        const x = Object.fromEntries(guardFeatures.map((name, j) => [name, p.guardX[j]]));
        assert(x.nextLossProbability + x.nextWinProbability <= 1 + 1e-12);
        assert(x.nextCoverLost + x.nextCoverGained <= 1 + 1e-12);
        const expectedNet = (1 - x.closedNext) * x.openNextNet + x.closedNext * x.closedNextNet;
        assert(Math.abs(expectedNet - x.nextUpside + x.nextDownside) < 1e-10);
      }
    }
  }
  assert(sawTarget && offTarget > 0, "Both policy branches must occur on training-only fixtures");
});
