import assert from 'node:assert/strict';
import test from 'node:test';
import {makeScenario, createWorld, observe, availableActions} from '../docs/lib/world.js';
import {blankCheckpoint, chooseAction, FEATURE_NAMES, sampleAction} from '../docs/lib/policy.js';
import {familyWeights} from '../training/run.mjs';
import {FINAL_TEST, HELD_OUT, PILOT, TRAIN, VALIDATION, prng} from '../training/protocol.mjs';

test('an untrained browser checkpoint selects a real call reproducibly from a public snapshot', () => {
  const obs = observe(createWorld(makeScenario(83, 'route-closure')));
  const original = structuredClone(obs);
  const action = chooseAction(obs, blankCheckpoint());
  assert.deepEqual(action, chooseAction(structuredClone(obs), 'untrained'));
  assert.ok(availableActions(obs).some(candidate => JSON.stringify(candidate) === JSON.stringify(action)));
  assert.deepEqual(obs, original);
  assert.throws(() => chooseAction(obs, {weights: []}), /checkpoint/);
});

test('REINFORCE scores can change action preferences and provide a finite centered score gradient', () => {
  const obs = observe(createWorld(makeScenario(51, 'normal')));
  const checkpoint = blankCheckpoint();
  checkpoint.weights[FEATURE_NAMES.indexOf('advance_time')] = 50;
  assert.equal(chooseAction(obs, checkpoint).tool, 'advance_time');
  const sample = sampleAction(obs, checkpoint.weights, prng(73));
  assert.equal(sample.action.tool, 'advance_time');
  assert.ok(sample.grad.every(Number.isFinite));
  // The expected feature vector equals that of a near-certain action.
  assert.ok(sample.grad.every(value => Math.abs(value) < 1e-9));
});

test('the adaptive sampler responds to observed family failures and preserves support', () => {
  const confidence = TRAIN.map(() => 1);
  confidence[2] = 0;
  const weights = familyWeights(confidence, 'adaptive');
  assert.ok(weights[2] > weights[0]);
  assert.ok(weights.every(value => value >= 0.2 / TRAIN.length));
  assert.ok(Math.abs(weights.reduce((a,b) => a+b, 0) - 1) < 1e-12);
  assert.deepEqual(familyWeights(confidence, 'uniform'), TRAIN.map(() => 1 / TRAIN.length));
});

test('fixed evaluation splits are paired and distinct', () => {
  assert.equal(PILOT.length, 100);
  assert.equal(VALIDATION.length, 60);
  assert.equal(FINAL_TEST.length, 168);
  assert.ok(HELD_OUT.every(kind => !TRAIN.includes(kind)));
  assert.equal(new Set(FINAL_TEST.map(row => row.kind + ':' + row.seed)).size, FINAL_TEST.length);
  assert.ok(VALIDATION.every(row => TRAIN.includes(row.kind)));
  const validationSeeds = new Set(VALIDATION.map(row => row.seed));
  assert.ok(FINAL_TEST.every(row => !validationSeeds.has(row.seed)));
});
