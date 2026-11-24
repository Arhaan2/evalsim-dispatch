import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus, arch, release } from 'node:os';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initAdapter, randomStream, update } from '../../language-model/adapter.mjs';
import { openEncoder } from '../../language-model/worker.mjs';
import { planner, noCheck, rewardShift } from '../../../docs/lib/cutoff.js';
import { cachedEncoder, hash, imitate, prompt, slotsFor } from './model.mjs';
import { cases, episode, model, modelAction, protocol as p, summarize } from './experiment.mjs';
import { fingerprints } from './integrity.mjs';

const [encoderPath, modelPath, runDirectory, outputFile] = process.argv.slice(2);
if (!outputFile) throw new Error('Usage: node run.mjs ENCODER MODEL PRIVATE_CACHE PUBLIC_RESULT_JSON');
const output = resolve(outputFile), artifacts = join(resolve(output, '..'), 'qwen');
await mkdir(artifacts, { recursive: true });
const source = await fingerprints();
const encoder = await openEncoder(encoderPath, modelPath, model.sha256);
const cache = await cachedEncoder(encoder, runDirectory, model.sha256);
const started = performance.now();
const counts = () => ({ ...cache.counts, wallSeconds: (performance.now() - started) / 1000 });
const cost = before => Object.fromEntries(Object.entries(counts()).map(([k, value]) => [k, value - before[k]]));
const save = async (file, value) => {
  await writeFile(file + '.tmp', JSON.stringify(value) + '\n');
  await rename(file + '.tmp', file);
};
function shuffle(rows, random) {
  for (let j = rows.length - 1; j > 0; j--) {
    const i = Math.floor(random() * (j + 1));
    [rows[j], rows[i]] = [rows[i], rows[j]];
  }
}

try {
  const training = [], checkpoints = [], adapters = [];
  for (const [r, seed] of p.replicates.entries()) {
    const random = randomStream(seed);
    const offset = r * p.replicateStride;
    const examples = [], demonstrations = [], groups = [];
    const demoStart = counts();
    for (const config of cases(p.demoStart + offset, p.demoSeeds, 'train')) {
      const path = await episode(config, async (obs, calls) => {
        const action = planner(obs);
        if (calls.length > 1) {
          const target = calls.findIndex(a => a.id === action);
          assert(target >= 0);
          examples.push({ target, slots: slotsFor(calls), representation: await cache.encode(prompt(obs, calls)) });
        }
        return { action };
      });
      demonstrations.push(path);
    }
    const adapter = initAdapter(examples[0].representation.h.length, random);
    const sftOpt = { steps: 0 };
    for (let e = 0; e < p.demoPasses; e++) {
      shuffle(examples, random);
      for (let b = 0; b < examples.length; b += p.demoBatch) imitate(adapter, examples.slice(b, b + p.demoBatch), sftOpt);
    }
    const sft = structuredClone(adapter);
    const demoCompute = cost(demoStart);
    const rlStart = counts(), rlOpt = { steps: 0 };
    for (const config of cases(p.rlStart + offset, p.rlSeeds, 'train')) {
      const group = [], logs = [];
      for (let j = 0; j < p.rolloutsPerGroup; j++) {
        const records = [];
        const path = await episode(config, (obs, calls) => modelAction(obs, calls, adapter, cache,
          { records, random, temperature: p.temperature }));
        const reward = rewardShift(path.metrics);
        assert(Number.isFinite(reward));
        group.push({ records, reward });
        logs.push(path);
      }
      update(adapter, group, rlOpt, p.temperature);
      groups.push(logs);
    }
    const rlCompute = cost(rlStart);
    const checkpoint = {};
    for (const [stage, weights] of Object.entries({ sft, rl: adapter })) {
      const file = 'seed-' + seed + '-' + stage + '.json';
      await save(join(artifacts, file), weights);
      checkpoint[stage] = { file, sha256: hash(await readFile(join(artifacts, file))) };
    }
    checkpoints.push(checkpoint);
    adapters.push({ sft, rl: adapter });
    training.push({ seed, demonstrations, groups, demoSteps: sftOpt.steps, rlSteps: rlOpt.steps,
      compute: { imitation: demoCompute, rl: rlCompute } });
    console.log('Trained replicate', r + 1, 'of', p.replicates.length, counts());
  }
  const heldOut = cases(p.testStart, p.testSeeds, 'test');
  const evalStart = counts(), evaluations = { planner: [], noCheck: [], frozen: [], sft: [], rl: [] };
  for (const [name, policy] of Object.entries({ planner, noCheck })) {
    const rows = [];
    for (const spec of heldOut) rows.push(await episode(spec, obs => ({ action: policy(obs) })));
    evaluations[name].push(rows);
  }
  const frozen = initAdapter(adapters[0].sft.size, randomStream(0));
  for (const name of ['frozen', 'sft', 'rl']) {
    const policies = name === 'frozen' ? [frozen] : adapters.map(a => a[name]);
    for (const a of policies) {
      const rows = [];
      for (const spec of heldOut) rows.push(await episode(spec, (obs, calls) => modelAction(obs, calls, a, cache)));
      evaluations[name].push(rows);
    }
    console.log('Evaluated', name, counts());
  }
  const result = { version: 1, protocol: p, model: { upstream: model.upstream, sha256: model.sha256, runtime: model.runtime },
    source, checkpoints, summary: summarize(evaluations), training, evaluations,
    compute: { node: process.version, machine: cpus()[0].model, arch: arch(), osRelease: release(), training: training.map(t => t.compute),
      evaluation: cost(evalStart), total: counts() } };
  await save(output, result);
  console.log(JSON.stringify(result.summary));
} finally {
  encoder.close();
}
