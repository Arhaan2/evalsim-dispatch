import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchedCpu } from './matched-cpu.mjs';
import { behavior, callCounts } from './behavior.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { noCheck, planner, rewardShift } from '../../../docs/lib/cutoff.js';
import { cases, episode, model, protocol as p, summarize } from './experiment.mjs';
import { fingerprints } from './integrity.mjs';
import { hash } from './model.mjs';

const main = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('../../../docs/data/cutoff/qwen.json', import.meta.url);
const report = JSON.parse(await readFile(main));
assert.equal(report.model.sha256, model.sha256);
assert.deepEqual(report.protocol, p);
assert.deepEqual(report.source, await fingerprints());
const raw = await readFile(new URL(report.transcript.file, main));
assert.equal(hash(raw), report.transcript.sha256);
const { training, evaluations } = JSON.parse(raw);
const heldOut = cases(p.testStart, p.testSeeds, 'test');
let auditedCalls = 0;
async function replay(path, spec, policy, sampled) {
  assert.deepEqual({ seed: path.seed, split: path.split, family: path.family, variant: path.variant }, spec);
  let step = 0;
  const rerun = await episode(spec, (o, calls) => {
    const d = path.decisions[step++];
    if (policy) assert.equal(policy(o), d.action);
    else {
      const probs = d.probabilities;
      assert(probs && probs.length === calls.length);
      assert(probs.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
      assert(Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 1e-7);
      const chosen = calls.findIndex(c => c.id === d.action);
      assert(chosen >= 0 && probs[chosen] > 0);
      if (!sampled) assert.equal(chosen, probs.indexOf(Math.max(...probs)));
    }
    return d;
  });
  assert.deepEqual(rerun, path);
  assert.equal(rerun.metrics.calls, path.decisions.length);
  assert(Number.isFinite(rewardShift(rerun.metrics)));
  auditedCalls += path.decisions.length;
}
assert.equal(training.length, p.replicates.length);
for (const [r, record] of training.entries()) {
  assert.equal(record.seed, p.replicates[r]);
  const demos = cases(p.demoStart + r * p.replicateStride, p.demoSeeds, 'train');
  assert.equal(record.demonstrations.length, demos.length);
  for (const [i, demo] of record.demonstrations.entries()) await replay(demo, demos[i], planner, false);
  const groups = cases(p.rlStart + r * p.replicateStride, p.rlSeeds, 'train');
  assert.equal(record.groups.length, groups.length);
  assert.equal(record.rlSteps, groups.length);
  for (const [i, paths] of record.groups.entries()) {
    assert.equal(paths.length, p.rolloutsPerGroup);
    for (const path of paths) await replay(path, groups[i], null, true);
  }
  for (const stage of ['sft', 'rl']) {
    const { file, sha256 } = report.checkpoints[r][stage];
    const data = await readFile(new URL('qwen/' + file, main));
    assert.equal(hash(data), sha256);
    const adapter = JSON.parse(data);
    assert.equal(adapter.rank, 4);
    assert.equal(adapter.size, 2560);
    assert.equal(adapter.input.length, adapter.rank * adapter.size);
    assert.equal(adapter.output.length, 8 * adapter.rank);
    assert([...adapter.input, ...adapter.output].every(Number.isFinite));
  }
}
for (const [name, replicas] of Object.entries(evaluations)) {
  assert.equal(replicas.length, ['rl', 'sft'].includes(name) ? p.replicates.length : 1);
  for (const rows of replicas) {
    assert.equal(rows.length, heldOut.length);
    for (const [i, path] of rows.entries()) await replay(path, heldOut[i], { planner, noCheck }[name], false);
  }
}
assert.deepEqual(report.matchedCpu, await matchedCpu());
assert.deepEqual(report.callCounts, callCounts(training, evaluations));
assert.deepEqual(report.behavior, behavior(evaluations));
assert.deepEqual(report.summary, summarize(evaluations));
console.log('Verified Qwen training and held-out transcripts across', auditedCalls, 'executed tool calls, six adapters and paired summaries.');
