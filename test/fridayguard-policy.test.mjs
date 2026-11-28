import assert from "node:assert/strict";
import test from "node:test";
import {closureActions, closureFrames} from "../docs/lib/closure-world.js";
import {closureFrame} from "../docs/lib/closure-planner.js";
import {chooseFridayGuard, decideFridayGuard, fridayGuardProposal, guardEstimates, guardFeatureNames} from "../docs/lib/fridayguard-policy.js";
import {choosePosition, predictMenus, prepositionProposal} from "../docs/lib/preposition-policy.js";
import {fitHeads} from "../training/fridayguard/boost.mjs";
import {selectCandidate, weights} from "../training/fridayguard/fit.mjs";

test("a prediction must clear the hurdle strictly; ordered ties favor 211 and zero predictions preserve 101", () => {
  const choices = [{id:"211", friday:.25, service:0, net:-34}, {id:"parent", friday:0, service:1, net:0}];
  const settings = {serviceWeight:.25, netWeight:0, hurdle:.25};
  assert.equal(chooseFridayGuard("101", choices, settings), "101");
  assert.equal(chooseFridayGuard("101", choices, {...settings, hurdle:0}), "211");
  assert.equal(chooseFridayGuard("101", choices, {...settings, hurdle:0, netWeight:1}), "parent");
  assert.equal(chooseFridayGuard("101", choices, {...settings, alwaysDefault:true}), "101");
});

test("selection handles feasible, least-shortfall and inactive grids in preregistered tie order", () => {
  const row = (id, friday, service, net, changed = 1) => ({settings:{id}, friday, service, net, changed});
  assert.equal(selectCandidate([row(1, 6, -1, 0), row(2, 1, 0, 1), row(3, 1, 1, 1)]).settings.id, 3);
  assert.equal(selectCandidate([row(1, -1, 100, 100), row(2, 6, 0, -33), row(3, 6, 0, -33)]).settings.id, 2);
  assert.equal(selectCandidate([row(1, 0, 0, 0, 0)]).mode, "always-default");
});

test("disagreements use only the observed board and preserve each frozen policy's legal action", () => {
  // Small generated unit fixtures, outside all experiment banks. Exercise menus
  // from every ordered start so the test includes an actual policy disagreement.
  let exercised = 0;
  for (let seed = 234111; seed < 234123; seed++) {
    const fixture = d => closureFrames({seed, family:"eastbound", closure:{starts:[7], durations:[d]}});
    const one = fixture(1), five = fixture(5);
    assert.deepEqual(one[6], five[6]);
    assert.equal(fridayGuardProposal(closureFrame(one[5]), closureActions(one[5]), weights).choices.length, 0);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const obs = {...one[6], positions:[a, b]}, laterRepair = {...five[6], positions:[a, b]};
      const menu = closureActions(obs), p = fridayGuardProposal(closureFrame(obs), menu, weights);
      assert.deepEqual(p, fridayGuardProposal(closureFrame(laterRepair), closureActions(laterRepair), weights));
      const original = prepositionProposal(closureFrame(obs), menu, weights);
      for (const [name, id] of [["preposition101", p.fit101Id], ["preposition211", p.fit211Id]]) {
        assert.equal(id, choosePosition(predictMenus(original, weights[name]), original.parentId, weights[name].settings).chosenId);
      }
      assert.deepEqual(p.choices.map(c => c.id), [...new Set([p.fit211Id, p.parentId])].filter(id => id !== p.fit101Id));
      for (const c of p.choices) {assert.equal(c.x.length, guardFeatureNames.length); assert(c.x.every(Number.isFinite));}
      const heads = Object.fromEntries(["friday", "service", "net"].map(k => [k, {bias:0, trees:[]}]));
      assert.equal(decideFridayGuard(p, {heads, settings:{hurdle:0, serviceWeight:1, netWeight:1}}), p.fit101Id);
      exercised += p.choices.length;
    }
  }
  assert(exercised > 0);
});

test("separate outcome heads learn paired differences and score unseen synthetic inputs", () => {
  const rows = Array.from({length:128}, (_, i) => ({x:[i], friday:Number(i >= 64), service:Number(i < 64), net:i < 64 ? -5 : 7}));
  const config = {rounds:8, depth:2, rate:.2, minLeaf:8, bins:16, l2:2};
  const heads = fitHeads(rows, config);
  const [low, high] = guardEstimates([{id:"a", x:[2.5]}, {id:"b", x:[125.5]}], heads);
  assert(high.friday > low.friday + .5); assert(low.service > high.service + .5); assert(high.net > low.net + 5);
  assert.deepEqual(heads, fitHeads(rows, config));
});
