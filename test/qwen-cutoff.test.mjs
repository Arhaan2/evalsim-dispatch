import test from 'node:test';
import assert from 'node:assert/strict';
import { createShift, observeShift, availableCalls } from '../docs/lib/cutoff.js';
import { initAdapter, randomStream } from '../training/language-model/adapter.mjs';
import { imitate, probabilities, prompt, slotsFor } from '../training/cutoff/qwen/model.mjs';

test('uncertain twins expose identical Qwen inputs and the complete public menu', () => {
  const obs = [0, 1].map(variant => observeShift(createShift({ seed: 42, family: 'uncertain', variant })));
  const calls = obs.map(availableCalls);
  assert.equal(prompt(obs[0], calls[0]), prompt(obs[1], calls[1]));
  assert.equal(new Set(slotsFor(calls[0])).size, calls[0].length);
  for (const a of calls[0]) assert(prompt(obs[0], calls[0]).includes(a.label));
});

test('imitation updates raise the demonstrated action probability under the shared action mask', () => {
  const adapter = initAdapter(5, randomStream(17));
  const representation = { logits: [1, 2, -1, 0, 1, 1, 0, 0], h: [2, 1, -3, -4, 1] };
  const slots = [0, 2, 5], target = 1;
  const before = probabilities(adapter, representation, slots, 1).probs[target];
  const state = {steps: 0};
  for (let i = 0; i < 15; i++) imitate(adapter, [{ slots, target, representation }], state);
  assert(probabilities(adapter, representation, slots, 1).probs[target] > before);
});
