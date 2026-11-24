import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, distribution, initAdapter, project, randomStream, update } from '../training/language-model/adapter.mjs';
import { promptFor, toolMenu } from '../training/language-model/menu.mjs';
import { availableActions, createWorld, makeScenario, observe, step } from '../docs/lib/world.js';

test('zero adapter preserves base logits and a rewarded action increases in probability', () => {
  const h = [0.4, -0.5, 1.8];
  const adapter = initAdapter(h.length, randomStream(98));
  const slots = [1, 4, 7];
  const logits = [0, 0, 0, 0, 0.4, 0, 0, -0.4];
  const z = project(adapter, h);
  const probs = distribution(logits, z, adapter, slots);
  assert.equal(choose(probs), 1);
  assert.ok(Math.abs(probs[1] / probs[0] - Math.exp(0.4)) < 1e-12);
  const group = [2, 0, 1].map((chosen, i) => ({ reward: i === 0 ? 1 : 0, records: [{ h, z, slots, probs, chosen }] }));
  update(adapter, group, { steps: 0 }, 1);
  assert.ok(distribution(logits, project(adapter,h), adapter, slots)[2] > probs[2]);
});

test('every offered language-model choice is a public tool candidate', () => {
  const world = createWorld(makeScenario(81, 'compound'));
  while (!world.done) {
    const obs = observe(world);
    const menu = toolMenu(obs);
    assert.ok(menu.size >= 1 && menu.size <= 8);
    for (const a of menu.values()) assert.ok(availableActions(obs).some(b => JSON.stringify(a) === JSON.stringify(b)));
    const prompt = promptFor(obs, menu);
    assert.ok(!prompt.includes('witnessRoutes'));
    assert.ok(prompt.endsWith('<|im_start|>assistant\n'));
    step(world, [...menu.values()][0]);
  }
});
