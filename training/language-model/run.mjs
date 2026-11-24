import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { arch, cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWorld, dispatcher, makeScenario, observe, step, verify, WORLD_VERSION } from '../../docs/lib/world.js';
import { choose, distribution, initAdapter, project, randomStream, update, LABELS } from './adapter.mjs';
import { promptFor, toolMenu } from './menu.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const protocol = JSON.parse(await readFile(join(here, 'protocol.json'), 'utf8'));
const [binary, model, work, destination] = process.argv.slice(2);
if (!binary || !model || !work || !destination) {
  throw new Error('Usage: node training/language-model/run.mjs <encoder> <model.gguf> <private-run-directory> <public-result-directory>');
}
await mkdir(work, { recursive: true });
await mkdir(destination, { recursive: true });
const digest = createHash('sha256');
for await (const chunk of createReadStream(model)) digest.update(chunk);
if (digest.digest('hex') !== protocol.sha256) throw new Error('Model checksum differs from protocol');
const sourceDigest = createHash('sha256');
for (const name of ['protocol.json', 'run.mjs', 'menu.mjs', 'adapter.mjs', 'encode.cpp', '../../docs/lib/world.js']) {
  sourceDigest.update(await readFile(join(here, name)));
}
const signature = sourceDigest.digest('hex');
const progressPath = join(work, 'progress.json');
const save = async (path, value) => {
  await writeFile(path + '.tmp', JSON.stringify(value) + '\n');
  await rename(path + '.tmp', path);
};
let state;
try { state = JSON.parse(await readFile(progressPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (state && state.signature !== signature) throw new Error('Progress belongs to a different protocol or implementation');
state ??= { signature, adapter: null, optimizer: { steps: 0 }, training: [], cases: [], trainingMs: 0, evaluationMs: 0,
  calls: 0, evaluatedTokens: 0, promptedTokens: 0 };
const child = spawn(resolve(binary), [resolve(model)], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
child.stdin.on('error', () => {});
const stopChild = () => child.kill();
process.once('exit', stopChild);
process.once('SIGTERM', () => process.exit(143));
process.once('SIGINT', () => process.exit(130));
const cache = new Map();
async function encode(prompt) {
  const existing = cache.get(prompt);
  if (existing) return existing;
  child.stdin.write(Buffer.byteLength(prompt) + '\n' + prompt);
  const line = await lines.next();
  if (line.done) throw new Error('Local model worker exited before returning logits');
  const data = JSON.parse(line.value);
  if (!data.logits.every(Number.isFinite) || !data.hidden.every(Number.isFinite)) throw new Error('Invalid model output');
  const result = { logits: data.logits, h: Float32Array.from(data.hidden) };
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  cache.set(prompt, result);
  state.calls++;
  state.evaluatedTokens += data.evaluated;
  state.promptedTokens += data.tokens;
  return result;
}

async function episode(seed, family, mode, random, capture = false) {
  const world = createWorld(makeScenario(seed, family));
  const records = [], trace = [], actions = [];
  while (!world.done) {
    const obs = observe(world);
    let action, choices;
    if (mode === 'dispatcher') action = dispatcher(obs);
    else {
      const menu = toolMenu(obs);
      const slots = [...menu.keys()];
      let chosen = 0;
      if (slots.length > 1) {
        const { h, logits } = await encode(promptFor(obs, menu));
        state.adapter ??= initAdapter(h.length, randomStream(protocol.trainingSeed));
        const z = project(state.adapter, h);
        const probs = mode === 'base'
          ? distribution(logits, Array(4).fill(0), state.adapter, slots)
          : distribution(logits, z, state.adapter, slots, random ? protocol.temperature : 1);
        chosen = choose(probs, random);
        if (capture) choices = slots.map((slot, i) => ({ label: LABELS[slot], action: menu.get(slot), probability: probs[i] }));
        if (random) records.push({ h, z, probs, slots, chosen });
      }
      action = menu.get(slots[chosen]);
    }
    const out = step(world, action);
    if (!random) actions.push(action);
    if (capture) trace.push({ tick: obs.tick, action, result: out.message, ok: out.ok, events: out.events,
      choices, observation: { budget: obs.budget, orders: obs.orders, warehouses: obs.warehouses } });
  }
  const { fulfillmentRate, success, spend, rejectedActions, ...rest } = verify(world);
  if (rest.violations.length) throw new Error('Verifier failure: '+rest.violations.join(', '));
  const metrics = { success, fulfilled: rest.fulfilled, totalDemand: rest.totalDemand, spend, rejectedActions, toolCalls: rest.toolCalls };
  const reward = fulfillmentRate + 0.5 * Number(success) - 0.02 * spend / world.scenario.budget - 0.002 * rejectedActions;
  return { records, reward, metrics, trace, actions };
}

try {
  for (let i = state.training.length; i < protocol.groups; i++) {
    const began = performance.now();
    const family = protocol.trainFamilies[i % protocol.trainFamilies.length];
    const seed = protocol.trainSeedStart + i;
    const group = [];
    for (let j = 0; j < protocol.rolloutsPerGroup; j++) {
      const sample = randomStream(protocol.trainingSeed + 104729 * (i + 1) + 8191 * j);
      group.push(await episode(seed, family, 'trained', sample));
    }
    update(state.adapter, group, state.optimizer, protocol.temperature);
    state.training.push({ group: i + 1, family, seed, rewards: group.map(row => row.reward), episodes: group.map(row => row.metrics) });
    state.trainingMs += performance.now() - began;
    await save(progressPath, state);
    console.log('Training group', i + 1, '/', protocol.groups, 'verified', group.map(s => s.metrics.fulfilled+'/'+s.metrics.totalDemand).join(' '));
  }
  const total = protocol.testFamilies.length * protocol.testSeedsPerFamily;
  for (let i = state.cases.length; i < total; i++) {
    const began = performance.now();
    const family = protocol.testFamilies[i % protocol.testFamilies.length];
    const seed = protocol.testSeedStart + i;
    const row = { seed, family, actions: {} };
    const capture = i === protocol.testFamilies.indexOf('compound');
    for (const mode of ['base', 'trained', 'dispatcher']) {
      const result = await episode(seed, family, mode, null, capture);
      row[mode] = result.metrics;
      row.actions[mode] = result.actions;
      if (capture) await save(join(destination, 'trace-'+mode+'.json'), { family, seed, mode, metrics: result.metrics, trace: result.trace });
    }
    state.cases.push(row);
    state.evaluationMs += performance.now() - began;
    await save(progressPath, state);
    console.log('Paired evaluation', i + 1, '/', total, row.base.fulfilled, row.trained.fulfilled, row.dispatcher.fulfilled);
  }
  const summary = {};
  for (const mode of ['base', 'trained', 'dispatcher']) {
    const rows = state.cases.map(row => row[mode]);
    const sum = key => rows.reduce((n, row) => n + Number(row[key]), 0);
    summary[mode] = { successes: sum('success'), episodes: rows.length, onTime: sum('fulfilled'), demand: sum('totalDemand'),
      spend: sum('spend'), toolCalls: sum('toolCalls'), rejections: sum('rejectedActions') };
  }
  await save(join(destination, 'adapter.json'), { modelSha256: protocol.sha256, sourceSha256: signature, ...state.adapter });
  await save(join(destination, 'results.json'), { protocol, signature, worldVersion: WORLD_VERSION, summary,
    training: state.training, cases: state.cases,
    compute: { platform: platform(), osRelease: release(), architecture: arch(), processor: cpus()[0].model,
      node: process.version, trainingSeconds: state.trainingMs / 1000, evaluationSeconds: state.evaluationMs / 1000,
      uncachedForwards: state.calls, promptTokens: state.promptedTokens, evaluatedTokens: state.evaluatedTokens } });
  console.log(JSON.stringify(summary));
} finally { child.stdin.end(); }
