import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {availableActions, makeScenario, createWorld, observe, step, verify} from '../docs/lib/world.js';
import {blankCheckpoint, chooseAction, FEATURE_NAMES, sampleAction} from '../docs/lib/policy.js';
import {BATCH, CHECKPOINTS, FINAL_TEST, GAMMA, HELD_OUT, LEARNING_RATE, PILOT, REPLICATES, TARGET, TRAIN, VALIDATION, prng} from './protocol.mjs';

const data = new URL('../docs/data/', import.meta.url);
const local = new URL('./runs/', import.meta.url);
const average = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const round = value => Number(value.toFixed(6));
const json = async (dir, path, value) => {
  await mkdir(dir, {recursive: true});
  await writeFile(new URL(path, dir), JSON.stringify(value) + '\n');
};
const load = async (dir, path) => JSON.parse(await readFile(new URL(path, dir), 'utf8'));

function summarize(reports) {
  return Object.fromEntries(['fulfillment', 'success', 'cost', 'toolCalls', 'violations'].map(key =>
    [key, round(average(reports.map(row => row[key])))]));
}

function metrics(result) {
  return {
    fulfillment: result.fulfillmentRate,
    success: Number(result.success),
    cost: result.spend,
    toolCalls: result.toolCalls,
    violations: Array.isArray(result.violations) ? result.violations.length : result.violations,
  };
}

function rollout(scenario, choose) {
  const world = createWorld(scenario);
  let update;
  do {
    const obs = observe(world);
    update = step(world, choose(obs));
  } while (!update.done);
  return metrics(verify(world));
}

export function evaluate(cases, policy) {
  return cases.map(({kind, seed}) => ({
    kind, seed, ...rollout(makeScenario(seed, kind), obs => chooseAction(obs, policy)),
  }));
}

function hardware() {
  return {node: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model ?? 'unavailable', device: 'CPU'};
}

export async function signature() {
  const hash = createHash('sha256');
  for (const path of ['./protocol.mjs', './run.mjs', '../docs/lib/world.js', '../docs/lib/policy.js']) {
    hash.update(path);
    hash.update(await readFile(new URL(path, import.meta.url)));
  }
  return hash.digest('hex');
}

export function familyWeights(learningCurve, mode) {
  if (mode === 'uniform') return TRAIN.map(() => 1 / TRAIN.length);
  const difficulty = learningCurve.map(success => (0.2 + (1 - success)) ** 2);
  const total = difficulty.reduce((sum, value) => sum + value, 0);
  return difficulty.map(weight => 0.2 / TRAIN.length + 0.8 * weight / total);
}

function draw(weights, random) {
  let cursor = random();
  for (let i = 0; i < weights.length - 1; i++) if ((cursor -= weights[i]) < 0) return i;
  return weights.length - 1;
}

function episode(seed, kind, checkpoint, random) {
  const world = createWorld(makeScenario(seed, kind));
  const path = [];
  let update;
  do {
    const obs = observe(world);
    const {action, grad} = sampleAction(obs, checkpoint.weights, random);
    update = step(world, action);
    path.push({grad, reward: update.reward});
  } while (!update.done);
  return {path, report: metrics(verify(world))};
}

export async function train(mode, replicate) {
  if (!['adaptive','uniform'].includes(mode) || !REPLICATES.includes(replicate)) throw new Error('Unknown trial');
  const checkpoint = blankCheckpoint();
  const randomAction = prng(replicate);
  const randomFamily = prng(replicate + 30000);
  const profile = TRAIN.map(() => 0.5);
  const counts = TRAIN.map(() => 0);
  const baseline = TRAIN.map(() => Array(8).fill(0));
  const m = checkpoint.weights.map(() => 0);
  const v = m.slice();
  const history = [];
  const weights = [];
  let trainingCalls = 0;
  let validationCalls = 0;
  let trainingSeconds = 0;
  let validationSeconds = 0;
  let trainingCpuSeconds = 0;
  let updateNumber = 0;
  const last = CHECKPOINTS.at(-1);
  for (let start = 0; start <= last; start += BATCH) {
    if (CHECKPOINTS.includes(start)) {
      const clock = performance.now();
      const reports = evaluate(VALIDATION, checkpoint);
      validationSeconds += (performance.now() - clock) / 1000;
      validationCalls += reports.reduce((sum, row) => sum + row.toolCalls, 0);
      const record = {episodes: start, trainingCalls, validationCalls, trainingSeconds: round(trainingSeconds),
        trainingCpuSeconds: round(trainingCpuSeconds), validationSeconds: round(validationSeconds),
        ...summarize(reports), familyCounts: counts.slice()};
      history.push(record);
      weights.push(checkpoint.weights.slice());
      console.log(mode, replicate, start, trainingCalls, 'validation success', record.success, 'on-time units', record.fulfillment);
    }
    if (start === last) break;
    const clock = performance.now();
    const cpu = process.cpuUsage();
    const gradient = m.map(() => 0);
    let decisions = 0;
    for (let b = 0; b < BATCH; b++) {
      const family = draw(familyWeights(profile, mode), randomFamily);
      // Disjoint ranges per replicate. Modes see the same seed at each episode index.
      const seed = 10000 + REPLICATES.indexOf(replicate) * 100000 + start + b;
      const {path, report} = episode(seed, TRAIN[family], checkpoint, randomAction);
      trainingCalls += report.toolCalls;
      decisions += path.length;
      counts[family]++;
      profile[family] += 0.05 * (report.success - profile[family]);
      let value = 0;
      const returns = Array(8).fill(0);
      const frequencies = Array(8).fill(0);
      for (let t = path.length - 1; t >= 0; t--) {
        const {reward, grad} = path[t];
        value = reward + GAMMA * value;
        const bucket = Math.min(7, Math.floor(t / 5));
        const advantage = value - baseline[family][bucket];
        for (let j = 0; j < gradient.length; j++) gradient[j] += advantage * grad[j];
        returns[bucket] += value;
        frequencies[bucket]++;
      }
      // The state-independent baseline for a trajectory uses only previous trajectories.
      for (let bucket = 0; bucket < returns.length; bucket++) {
        if (frequencies[bucket]) baseline[family][bucket] += 0.08 * (returns[bucket] / frequencies[bucket] - baseline[family][bucket]);
      }
    }
    updateNumber++;
    for (let j = 0; j < gradient.length; j++) {
      const g = gradient[j] / decisions;
      m[j] = 0.9 * m[j] + 0.1 * g;
      v[j] = 0.999 * v[j] + 0.001 * g * g;
      const mHat = m[j] / (1 - 0.9 ** updateNumber);
      const vHat = v[j] / (1 - 0.999 ** updateNumber);
      checkpoint.weights[j] += LEARNING_RATE * mHat / (Math.sqrt(vHat) + 1e-8);
    }
    trainingSeconds += (performance.now() - clock) / 1000;
    const used = process.cpuUsage(cpu);
    trainingCpuSeconds += (used.user + used.system) / 1e6;
  }
  const result = {mode, replicate, signature: await signature(), hardware: hardware(), history, weights};
  await json(local, mode + '-' + replicate + '.json', result);
  return result;
}

async function pilot() {
  const clock = performance.now();
  const trials = PILOT.map(({kind, seed}) => {
    const random = prng(seed);
    return rollout(makeScenario(seed, kind), obs => {
      const options = availableActions(obs);
      return options[Math.floor(random() * options.length)];
    });
  });
  const seconds = (performance.now() - clock) / 1000;
  const result = {episodes: trials.length, hardware: hardware(), seconds: round(seconds),
    episodesPerSecond: round(trials.length / seconds), peakResidentMiB: round(process.resourceUsage().maxRSS / 1024),
    ...summarize(trials)};
  await json(data, 'pilot.json', result);
  console.log(result);
}

const checkpointFrom = (trial, position = -1) => ({...blankCheckpoint(), weights: trial.weights.at(position)});
function splitMetrics(rows) {
  return {all: summarize(rows),
    unseenSeeds: summarize(rows.filter(row => !HELD_OUT.includes(row.kind))),
    unseenFamilies: summarize(rows.filter(row => HELD_OUT.includes(row.kind)))};
}

async function publish() {
  const digest = await signature();
  const trials = [];
  for (const mode of ['adaptive', 'uniform']) {
    for (const replicate of REPLICATES) {
      const run = await load(local, mode + '-' + replicate + '.json');
      if (run.signature !== digest) throw new Error('Source changed since training ' + mode + ' ' + replicate);
      trials.push(run);
    }
  }
  const checkpoints = {
    untrained: blankCheckpoint(),
    trained: checkpointFrom(trials[0]),
    uniform: checkpointFrom(trials[REPLICATES.length]),
    replicates: trials.map(trial => ({mode: trial.mode, seed: trial.replicate, policy: checkpointFrom(trial)})),
    history: CHECKPOINTS.map((episodes, i) => ({episodes,
      trained: checkpointFrom(trials[0], i), uniform: checkpointFrom(trials[REPLICATES.length], i)})),
  };
  const roster = [
    {id:'untrained', label:'Before training', policy:checkpoints.untrained},
    {id:'dispatcher', label:'Dispatcher', policy:'dispatcher'},
    ...trials.map(trial => ({id:trial.mode, label:trial.mode === 'adaptive' ? 'Adaptive RL' : 'Uniform RL',
      replicate:trial.replicate, policy:checkpointFrom(trial)})),
  ];
  const rows = [];
  const trialSummary = [];
  for (const agent of roster) {
    const records = evaluate(FINAL_TEST, agent.policy);
    rows.push(...records.map(record => ({id:agent.id, replicate:agent.replicate ?? null, ...record})));
    trialSummary.push({id:agent.id, replicate:agent.replicate ?? null, label:agent.label, ...splitMetrics(records)});
  }
  const summary = ['untrained', 'dispatcher', 'uniform', 'adaptive'].map(id => ({
    id, label: roster.find(agent => agent.id === id).label,
    ...summarize(rows.filter(row => row.id === id)),
    ...splitMetrics(rows.filter(row => row.id === id)),
  }));
  const curves = CHECKPOINTS.map((episodes, t) => {
    const row = {episodes};
    for (const mode of ['adaptive','uniform']) {
      const records = trials.filter(trial => trial.mode === mode).map(trial => trial.history[t]);
      row[mode] = round(average(records.map(trial => trial.fulfillment)));
      row[mode + 'Success'] = round(average(records.map(trial => trial.success)));
      row[mode + 'Calls'] = Math.round(average(records.map(trial => trial.trainingCalls)));
    }
    return row;
  });
  const result = {
    format: 1, method: 'REINFORCE with a linear softmax action policy and ' + FEATURE_NAMES.length + ' observable features.',
    featureCount: FEATURE_NAMES.length, features: FEATURE_NAMES, signature: digest,
    hardware: trials[0].hardware, threshold: TARGET, thresholdMetric: 'Validation episode success',
    testCases: FINAL_TEST.length, validationCases: VALIDATION.length, trainingSeeds: REPLICATES,
    demoTrainingSeed: REPLICATES[0], episodesPerRun: CHECKPOINTS.at(-1),
    trainFamilies: TRAIN, heldOutFamilies: HELD_OUT, curves, summary, trialSummary,
    runs: trials.map(trial => ({
      mode: trial.mode, replicate: trial.replicate, history: trial.history,
      firstThreshold: trial.history.find(point => point.success >= TARGET) ?? null,
    })),
  };
  await json(data, 'checkpoints.json', checkpoints);
  await json(data, 'experiment.json', result);
  await json(data, 'test-outcomes.json', rows);
  console.log(JSON.stringify({curves, summary}, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, mode, seed] = process.argv.slice(2);
  if (command === 'pilot') await pilot();
  else if (command === 'train') await train(mode, Number(seed));
  else if (command === 'publish') await publish();
  else throw new Error('Usage: node training/run.mjs pilot | train {adaptive|uniform} {13|37|73} | publish');
}
