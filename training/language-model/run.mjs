import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { arch, cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWorld, dispatcher, makeScenario, observe, step, verify, WORLD_VERSION } from '../../docs/lib/world.js';
import { choose, distribution, initAdapter, project, randomStream, update, LABELS } from './adapter.mjs';
import { promptFor, toolMenu } from './menu.mjs';
import { openEncoder } from './worker.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const protocol = JSON.parse(await readFile(join(here, 'protocol.json'), 'utf8'));
const [binary, model, work, destination, schedule = 'balanced'] = process.argv.slice(2);
if (!binary || !model || !work || !destination) {
  throw new Error('Usage: node training/language-model/run.mjs <encoder> <model.gguf> <private-run-directory> <public-result-directory>');
}
await mkdir(work, { recursive: true });
await mkdir(destination, { recursive: true });
if (!Object.hasOwn(protocol.schedules, schedule)) throw new Error('Unknown training schedule');
const sourceDigest = createHash('sha256');
for (const name of ['protocol.json', 'run.mjs', 'menu.mjs', 'adapter.mjs', 'worker.mjs', 'encode.cpp', '../../docs/lib/world.js']) {
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
if (state && (state.signature !== signature || state.schedule !== schedule)) throw new Error('Progress belongs to a different protocol or implementation');
state ??= { signature, schedule, adapter: null, optimizer: { steps: 0 }, training: [], cases: [], validation: [], trainingMs: 0, evaluationMs: 0, validationMs: 0,
  calls: 0, evaluatedTokens: 0, promptedTokens: 0 };
const worker = await openEncoder(binary, model, protocol.sha256);
process.once('SIGTERM', () => process.exit(143));
process.once('SIGINT', () => process.exit(130));
const cache = new Map();
async function encode(prompt) {
  const existing = cache.get(prompt);
  if (existing) return existing;
  const data = await worker.encode(prompt);
  const result = { logits: data.logits, h: data.h };
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

function nextFamily(groupIndex) {
  if (schedule === 'balanced') return protocol.trainFamilies[groupIndex % protocol.trainFamilies.length];
  const estimates = new Map(protocol.trainFamilies.map(family => [family, 0.5]));
  for (const group of state.training) {
    const success = group.episodes.filter(e => e.success).length / group.episodes.length;
    estimates.set(group.family, 0.8 * estimates.get(group.family) + 0.2 * success);
  }
  const weights = [...estimates.values()].map(p => (1.2 - p) ** 2);
  const sum = weights.reduce((a,b) => a+b, 0);
  const probs = weights.map(w => 0.2 / weights.length + 0.8 * w / sum);
  return protocol.trainFamilies[choose(probs, randomStream(protocol.trainingSeed + (groupIndex + 1) * 2654435761))];
}

async function recordValidation(group) {
  if (!protocol.validationGroups.includes(group) || state.validation.some(v => v.group === group)) return;
  const start = performance.now();
  const metrics = [];
  for (let i = 0; i < protocol.trainFamilies.length * protocol.validationSeedsPerFamily; i++) {
    const run = await episode(protocol.validationSeedStart + i, protocol.trainFamilies[i % protocol.trainFamilies.length], 'trained');
    metrics.push(run.metrics);
  }
  state.validationMs += performance.now() - start;
  const observed = { group, successes: metrics.filter(r => r.success).length, episodes: metrics.length,
    toolCalls: metrics.reduce((s,r) => s+r.toolCalls, 0), trainingCalls: state.training.flatMap(g => g.episodes).reduce((s,r) => s+r.toolCalls,0),
    trainingSeconds: state.trainingMs/1000, metrics };
  state.validation.push(observed);
  await save(progressPath, state);
  console.log('Fixed validation at group', group, observed.successes, '/', observed.episodes);
}

try {
  await recordValidation(state.training.length);
  for (let i = state.training.length; i < protocol.groups; i++) {
    const began = performance.now();
    const family = nextFamily(i);
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
    await recordValidation(i + 1);
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
  await save(join(destination, 'results.json'), { protocol, signature, schedule, worldVersion: WORLD_VERSION, summary,
    training: state.training, validation: state.validation, cases: state.cases,
    compute: { platform: platform(), osRelease: release(), architecture: arch(), processor: cpus()[0].model,
      node: process.version, trainingSeconds: state.trainingMs / 1000, validationSeconds: state.validationMs / 1000, evaluationSeconds: state.evaluationMs / 1000,
      uncachedForwards: state.calls, promptTokens: state.promptedTokens, evaluatedTokens: state.evaluatedTokens } });
  console.log(JSON.stringify(summary));
} finally { worker.close(); }
