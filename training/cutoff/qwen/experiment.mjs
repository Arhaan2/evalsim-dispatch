import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { availableCalls, createShift, observeShift, stepShift, verifyShift } from '../../../docs/lib/cutoff.js';
import { choose, randomStream } from '../../language-model/adapter.mjs';
import { probabilities, prompt, slotsFor } from './model.mjs';

export const protocol = JSON.parse(await readFile(new URL('protocol.json', import.meta.url)));
export const model = JSON.parse(await readFile(new URL('../../language-model/protocol.json', import.meta.url)));
export const key = c => [c.seed, c.family, c.variant].join('/');

export function cases(start, seeds, split) {
  return Array.from({ length: seeds }, (_, i) => protocol.families.flatMap(family =>
    protocol.variants.map(variant => ({ seed: start + i, split, family, variant })))).flat();
}

export async function episode(config, act) {
  const world = createShift(config);
  const decisions = [];
  let obs = observeShift(world);
  while (!obs.done) {
    const calls = availableCalls(obs);
    const decision = await act(obs, calls);
    assert(calls.some(a => a.id === decision.action), 'Policy must act within the common cutoff menu');
    stepShift(world, decision.action);
    decisions.push(decision);
    obs = observeShift(world);
    assert(decisions.length < 100, 'Cutoff simulator failed to terminate');
  }
  const { success, onTimeUnits, totalUnits, calls, spend, violations } = verifyShift(world);
  assert.deepEqual(violations, []);
  return { ...config, decisions, metrics: { success, onTimeUnits, totalUnits, calls, spend } };
}

export async function modelAction(obs, calls, adapter, cache, options = {}) {
  if (calls.length === 1) return { action: calls[0].id, probabilities: [1] };
  const rep = await cache.encode(prompt(obs, calls));
  const record = probabilities(adapter, rep, slotsFor(calls), options.temperature ?? 1);
  const chosen = choose(record.probs, options.random);
  options.records?.push({ ...record, chosen });
  return { action: calls[chosen].id, probabilities: record.probs };
}

function average(values) { return values.reduce((total, n) => total + n, 0) / values.length; }

export function summarize(evaluations) {
  const policies = {};
  for (const [name, replicas] of Object.entries(evaluations)) {
    const successes = replicas.map(rows => rows.filter(row => row.metrics.success).length);
    const perFamily = Object.fromEntries(protocol.families.map(family => {
      const rates = replicas.map(rows => average(rows.filter(r => r.family === family).map(r => Number(r.metrics.success))));
      return [family, average(rates)];
    }));
    const inspectionRate = Object.fromEntries(protocol.families.map(family => {
      const rates = replicas.map(rows => average(rows.filter(r => r.family === family).map(r => Number(r.decisions.some(d => d.action === 'inspect')))));
      return [family, average(rates)];
    }));
    policies[name] = { successes, successRate: average(successes) / replicas[0].length, perFamily, inspectionRate };
  }
  const delta = evaluations.rl.map((rows, r) => rows.map((row, i) => {
    assert.equal(key(row), key(evaluations.sft[r][i]));
    return Number(row.metrics.success) - Number(evaluations.sft[r][i].metrics.success);
  }));
  const width = protocol.families.length * protocol.variants.length;
  const bySeed = delta.map(replica => Array.from({ length: protocol.testSeeds }, (_, i) =>
    average(replica.slice(i * width, (i + 1) * width))));
  const random = randomStream(protocol.bootstrapSeed), sample = [];
  for (let i = 0; i < protocol.bootstrapDraws; i++) {
    const seeds = bySeed[0].map(() => Math.floor(random() * protocol.testSeeds));
    const replicas = bySeed.map(() => bySeed[Math.floor(random() * bySeed.length)]);
    sample.push(average(replicas.map(r => average(seeds.map(s => r[s])))));
  }
  sample.sort((a, b) => a - b);
  const diffs = delta.flat();
  return {
    testCases: delta[0].length, trainingReplicates: delta.length, policies,
    paired: { wins: diffs.filter(n => n > 0).length, losses: diffs.filter(n => n < 0).length,
      ties: diffs.filter(n => n === 0).length, meanDifference: average(diffs),
      interval95: [sample[Math.floor(0.025 * sample.length)], sample[Math.ceil(0.975 * sample.length) - 1]] }
  };
}
