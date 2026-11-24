import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {CELLS, EXPLORATION, FAMILIES, cellProbabilities, checkFeasible, demandBand,
  sampleCell, softmax} from '../../docs/lib/challenger.js';
import {createWorld, makeScenario, observe, step, verify} from '../../docs/lib/world.js';
import {blankCheckpoint, sampleAction} from '../../docs/lib/policy.js';
import {evaluate, signature} from '../run.mjs';
import {BATCH, GAMMA, LEARNING_RATE, prng} from '../protocol.mjs';
import {BASELINE_RATE, BUDGET, CELLS_PER_BANK, CHALLENGER_RATE, CHECK_EVERY, COMPETENCE,
  ENTROPY_BONUS, FINAL, SEEDS, UNSEEN, VALIDATION} from './protocol.mjs';

export const output = new URL('../../docs/data/challenger/', import.meta.url);
const zeros = length => Array(length).fill(0);
const round = n => Number(n.toFixed(6));
const average = a => a.reduce((sum,n) => sum+n, 0) / a.length;
const seconds = start => (performance.now() - start) / 1000;
const cpuSeconds = start => {
  const usage = process.cpuUsage(start);
  return (usage.user + usage.system) / 1e6;
};

async function sourceFingerprint() {
  const hash = createHash('sha256').update(await signature());
  for (const name of ['./protocol.mjs','./run.mjs','../../docs/lib/challenger.js']) {
    hash.update(name).update(await readFile(new URL(name, import.meta.url)));
  }
  return hash.digest('hex');
}

export function buildBank(replicate) {
  const start = performance.now();
  const cpu = process.cpuUsage();
  const cells = CELLS.map(() => []);
  const startSeed = 4000000 + 10000 * SEEDS.indexOf(replicate);
  let witnessCalls = 0;
  for (let family = 0; family < FAMILIES.length; family++) {
    const ordinary = cells[2 * family];
    const high = cells[2 * family+1];
    for (let seed = startSeed; ordinary.length < CELLS_PER_BANK || high.length < CELLS_PER_BANK; seed++) {
      if (seed >= startSeed + 10000) throw new Error('Insufficient scenarios in training seed band');
      const scenario = makeScenario(seed, FAMILIES[family]);
      const bucket = demandBand(scenario) === 'high' ? high : ordinary;
      if (bucket.length === CELLS_PER_BANK) continue;
      const audit = checkFeasible(scenario);
      if (!audit.success) throw new Error('Witness schedule failed for training case ' + seed);
      witnessCalls += audit.toolCalls;
      bucket.push({seed, witnessSuccess: Number(audit.success)});
    }
  }
  return {cells, report: {replicate, scenarios: CELLS.length * CELLS_PER_BANK, witnessCalls,
    wallSeconds: round(seconds(start)), cpuSeconds: round(cpuSeconds(cpu))}};
}

// This policy gradient is for the exploration mixture, including its log-probability derivative.
// The entropy term applies to the trainable softmax before the exploration floor.
export function updateChallenger(teacher, chosen, reward) {
  const soft = softmax(teacher.logits);
  const mixed = cellProbabilities(teacher.logits);
  const scale = (1 - EXPLORATION) * soft[chosen] / mixed[chosen];
  const advantage = reward - teacher.baseline;
  const entropy = -soft.reduce((sum,p) => sum + p * Math.log(p), 0);
  for (let i = 0; i < teacher.logits.length; i++) {
    const gradient = advantage * scale * (Number(i === chosen) - soft[i]);
    const entropyGradient = -soft[i] * (Math.log(soft[i]) + entropy);
    teacher.logits[i] += CHALLENGER_RATE * (gradient + ENTROPY_BONUS * entropyGradient);
  }
  teacher.baseline += BASELINE_RATE * advantage;
}

// Match the fixed operator protocol's gradient, baseline, optimizer and update cadence.
function operatorOptimizer(checkpoint) {
  const width = checkpoint.weights.length;
  const baseline = FAMILIES.map(() => zeros(8));
  const gradient = zeros(width);
  const firstMoment = zeros(width);
  const secondMoment = zeros(width);
  let updates = 0;
  let batchDecisions = 0;
  let batchEpisodes = 0;

  function flush() {
    if (batchEpisodes === 0) return;
    updates++;
    for (let i = 0; i < width; i++) {
      const g = gradient[i] / batchDecisions;
      firstMoment[i] = 0.9 * firstMoment[i] + 0.1 * g;
      secondMoment[i] = 0.999 * secondMoment[i] + 0.001 * g * g;
      const m = firstMoment[i] / (1 - 0.9 ** updates);
      const v = secondMoment[i] / (1 - 0.999 ** updates);
      checkpoint.weights[i] += LEARNING_RATE * m / (Math.sqrt(v) + 1e-8);
    }
    gradient.fill(0);
    batchDecisions = 0;
    batchEpisodes = 0;
  }

  function accumulate(path, family) {
    let value = 0;
    const returns = zeros(8);
    const frequencies = zeros(8);
    for (let t = path.length - 1; t >= 0; t--) {
      const {reward, grad} = path[t];
      value = reward + GAMMA * value;
      const bucket = Math.min(7, Math.floor(t / 5));
      const advantage = value - baseline[family][bucket];
      for (let i = 0; i < width; i++) gradient[i] += advantage * grad[i];
      returns[bucket] += value;
      frequencies[bucket]++;
    }
    for (let b = 0; b < returns.length; b++) {
      if (frequencies[b]) baseline[family][b] += 0.08 * (returns[b] / frequencies[b] - baseline[family][b]);
    }
    batchEpisodes++;
    batchDecisions += path.length;
    if (batchEpisodes === BATCH) flush();
  }
  return {accumulate, flush, updates: () => updates};
}

export function trainTrial(mode, replicate, bank) {
  const start = performance.now();
  const cpu = process.cpuUsage();
  const checkpoint = blankCheckpoint();
  const optimize = operatorOptimizer(checkpoint);
  const teacher = {logits: zeros(CELLS.length), baseline: 0.5};
  const actionRng = prng(replicate);
  const cellRng = prng(replicate + 30000);
  const scenarioRng = prng(replicate + 60000);
  const draws = zeros(CELLS.length);
  const failures = zeros(CELLS.length);
  let trainingCalls = 0;
  let completed = 0;
  let partialCalls = 0;
  let validationCalls = 0;
  let validationCpu = 0;
  let validationWall = 0;
  const history = [];

  function record() {
    const vStart = performance.now();
    const vCpu = process.cpuUsage();
    const results = evaluate(VALIDATION, checkpoint);
    validationCalls += results.reduce((sum, r) => sum + r.toolCalls, 0);
    history.push({
      trainingCalls, completed, updates: optimize.updates(), success: round(average(results.map(r => r.success))),
      fulfillment: round(average(results.map(r => r.fulfillment))), validationCalls,
      probabilities: cellProbabilities(teacher.logits), logits: teacher.logits.slice(),
      sampled: draws.slice(), failures: failures.slice(), teacherBaseline: teacher.baseline,
    });
    validationCpu += cpuSeconds(vCpu);
    validationWall += seconds(vStart);
  }
  record();
  while (trainingCalls < BUDGET) {
    const chosen = sampleCell(cellProbabilities(teacher.logits), cellRng);
    const cell = CELLS[chosen];
    const samples = bank.cells[chosen];
    const task = samples[Math.floor(scenarioRng() * samples.length)];
    const world = createWorld(makeScenario(task.seed, cell.kind));
    const path = [];
    draws[chosen]++;
    while (!world.done && trainingCalls < BUDGET) {
      const {action, grad} = sampleAction(observe(world), checkpoint.weights, actionRng);
      const update = step(world, action);
      path.push({grad, reward: update.reward});
      trainingCalls++;
      if (world.done) {
        const success = Number(verify(world).success);
        const regret = task.witnessSuccess - success;
        failures[chosen] += 1 - success;
        if (mode === 'learned') updateChallenger(teacher, chosen, regret);
        optimize.accumulate(path, Math.floor(chosen / 2));
        completed++;
      }
      if (trainingCalls === BUDGET) {
        optimize.flush();
        if (!world.done) partialCalls = path.length;
      }
      if (trainingCalls % CHECK_EVERY === 0) record();
    }
  }
  return {mode, replicate, checkpoint, teacher, history, completed, partialCalls, trainingCalls,
    timing: {trainingCpuSeconds: round(cpuSeconds(cpu) - validationCpu),
      trainingWallSeconds: round(seconds(start) - validationWall),
      validationCpuSeconds: round(validationCpu), validationWallSeconds: round(validationWall)}};
}

function outcomeSummary(rows) {
  function group(items) {
    return {success: round(average(items.map(row => row.success))),
      fulfillment: round(average(items.map(row => row.fulfillment))),
      spend: round(average(items.map(row => row.cost))),
      calls: round(average(items.map(row => row.toolCalls))),
      violations: items.reduce((sum,row) => sum + row.violations, 0)};
  }
  return {overall:group(rows), familiar:group(rows.filter(row => !UNSEEN.includes(row.kind))),
    unseen:group(rows.filter(row => UNSEEN.includes(row.kind)))};
}

export async function experiment() {
  const trials = [];
  const banks = [];
  for (const replicate of SEEDS) {
    const bank = buildBank(replicate);
    banks.push(bank.report);
    for (const mode of ['uniform','learned']) trials.push(trainTrial(mode, replicate, bank));
  }
  const demo = trials.find(trial => trial.mode === 'learned' && trial.replicate === SEEDS[0]);
  const checkpoint = {format:'dispatch-challenger-v1', replicate: SEEDS[0], logits: demo.teacher.logits,
    probabilities: cellProbabilities(demo.teacher.logits), exploration: EXPLORATION, cells: CELLS};
  const evalStart = performance.now();
  const evalCpu = process.cpuUsage();
  const outcomes = [];
  for (const {mode, replicate, checkpoint:policy} of trials) {
    for (const row of evaluate(FINAL, policy)) outcomes.push({mode, replicate, ...row});
  }
  for (const row of evaluate(FINAL,'dispatcher')) outcomes.push({mode:'dispatcher', replicate:null, ...row});
  const evalTiming = {cpuSeconds:round(cpuSeconds(evalCpu)),wallSeconds:round(seconds(evalStart))};
  const summary = ['uniform','learned','dispatcher'].map(mode =>
    ({mode, ...outcomeSummary(outcomes.filter(r => r.mode === mode))}));
  const evaluationWitnesses = [...VALIDATION,...FINAL].map(({kind, seed}) => checkFeasible(makeScenario(seed,kind)));
  if (!evaluationWitnesses.every(caseResult => caseResult.success)) throw new Error('Infeasible validation/test case');
  const result = {
    format: 1, signature: await sourceFingerprint(), mode:'categorical REINFORCE challenger',
    hardware: {node:process.version, platform:process.platform, arch:process.arch, cpu:cpus()[0]?.model},
    seed: SEEDS[0], seeds: SEEDS, budget: BUDGET, threshold: COMPETENCE,
    finalCases: FINAL.length, unseenCases: FINAL.filter(x => UNSEEN.includes(x.kind)).length,
    validationCases: VALIDATION.length, cells:CELLS, banks, trials, summary, evaluationTiming:evalTiming,
    witnessAudit: {cases:evaluationWitnesses.length, successful:evaluationWitnesses.length,
      calls:evaluationWitnesses.reduce((sum,entry) => sum + entry.toolCalls,0)},
  };
  for (const run of trials) {
    run.finalEvaluation = outcomeSummary(outcomes.filter(r => r.mode === run.mode && r.replicate === run.replicate));
    run.firstThresholdCalls = run.history.find(p => p.success >= COMPETENCE)?.trainingCalls ?? null;
  }
  return {checkpoint, result, outcomes};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {checkpoint,result,outcomes} = await experiment();
  await mkdir(output,{recursive:true});
  for (const [name,value] of [['checkpoint',checkpoint],['experiment',result],['test-outcomes',outcomes]]) {
    await writeFile(new URL(name + '.json',output), JSON.stringify(value) + '\n');
  }
  console.log(JSON.stringify({summary:result.summary, challenger:checkpoint.probabilities},null,2));
}
