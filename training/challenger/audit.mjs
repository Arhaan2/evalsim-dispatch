import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CELLS, EXPLORATION, cellProbabilities, checkFeasible, demandBand, drawChallenge, softmax} from '../../docs/lib/challenger.js';
import {makeScenario} from '../../docs/lib/world.js';
import {BUDGET, CHALLENGER_RATE, ENTROPY_BONUS, SEEDS} from './protocol.mjs';
import {experiment, output, updateChallenger} from './run.mjs';

// Independently check the analytical log-probability and entropy gradients by finite differences.
const logits = CELLS.map((_,i) => (i - 5) / 8);
const teacher = {logits:logits.slice(), baseline:0.3};
const chosen = 2;
updateChallenger(teacher,chosen,1);
function objective(values) {
  const soft = softmax(values);
  const probability = EXPLORATION / CELLS.length + (1 - EXPLORATION) * soft[chosen];
  const entropy = -soft.reduce((total,p) => total + p * Math.log(p),0);
  return 0.7 * Math.log(probability) + ENTROPY_BONUS * entropy;
}
for (let i = 0; i < logits.length; i++) {
  const high = logits.slice(), low = logits.slice();
  high[i] += 1e-5;
  low[i] -= 1e-5;
  const numerical = (objective(high) - objective(low)) / 2e-5;
  assert.ok(Math.abs(numerical - (teacher.logits[i] - logits[i]) / CHALLENGER_RATE) < 1e-8);
}
assert.ok(cellProbabilities(teacher.logits).every(p => p >= EXPLORATION / CELLS.length));

const read = async name => JSON.parse(await readFile(new URL(name + '.json',output), 'utf8'));
const published = await read('experiment');
const expectedCheckpoint = await read('checkpoint');
const expectedOutcomes = await read('test-outcomes');
const actual = await experiment();

// Math.exp and Math.log can round differently across V8 builds and processor families.
// Only learned, unrounded parameter fields may vary by this absolute tolerance.
const parameterTolerance = 1e-12;
function matchParameters(actualObject, expectedObject, fields, label) {
  for (const name of fields) {
    const actualValue = actualObject[name];
    const expectedValue = expectedObject[name];
    assert.equal(Array.isArray(actualValue), Array.isArray(expectedValue), label + '.' + name + ' shape');
    const values = Array.isArray(actualValue) ? actualValue : [actualValue];
    const references = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
    assert.equal(values.length, references.length, label + '.' + name + ' length');
    for (let i = 0; i < values.length; i++) {
      assert.ok(Number.isFinite(values[i]) && Number.isFinite(references[i]) &&
        Math.abs(values[i] - references[i]) <= parameterTolerance,
        label + '.' + name + '[' + i + '] parameter drift');
    }
    // The exact comparison that follows still sees every other field and key.
    actualObject[name] = expectedValue;
  }
}

function deterministicFields(result) {
  // Host identity and measured timings describe the machine that performed the run.
  for (const field of ['node','platform','arch']) {
    assert.ok(typeof result.hardware?.[field] === 'string' && result.hardware[field].length > 0,
      'Missing execution hardware field ' + field);
  }
  const copy = structuredClone(result);
  delete copy.hardware;
  delete copy.evaluationTiming;
  copy.banks.forEach(bank => { delete bank.wallSeconds; delete bank.cpuSeconds; });
  copy.trials.forEach(trial => { delete trial.timing; });
  return copy;
}

const rerun = deterministicFields(actual.result);
const reference = deterministicFields(published);
assert.equal(rerun.trials.length, reference.trials.length);
for (const [i, trial] of rerun.trials.entries()) {
  const expected = reference.trials[i];
  const label = trial.mode + '/' + trial.replicate;
  matchParameters(trial.checkpoint, expected.checkpoint, ['weights'], label + '/operator');
  matchParameters(trial.teacher, expected.teacher, ['logits','baseline'], label + '/challenger');
  assert.equal(trial.history.length, expected.history.length);
  for (const [j, point] of trial.history.entries()) {
    matchParameters(point, expected.history[j], ['probabilities','logits','teacherBaseline'], label + '/history/' + j);
  }
}
assert.deepEqual(rerun, reference);
assert.deepEqual(actual.outcomes,expectedOutcomes);
const publicCheckpoint = structuredClone(actual.checkpoint);
matchParameters(publicCheckpoint, expectedCheckpoint, ['logits','probabilities'], 'public challenger');
assert.deepEqual(publicCheckpoint, expectedCheckpoint);
assert.equal(published.trials.length,2 * SEEDS.length);
assert.ok(published.trials.every(trial => trial.trainingCalls === BUDGET));
const drawn = new Set();
for (let i = 0; i < 48; i++) {
  const choice = drawChallenge(actual.checkpoint,i);
  assert.deepEqual(choice,drawChallenge(actual.checkpoint,i));
  const world = makeScenario(choice.seed,choice.kind);
  assert.equal(choice.cell,choice.kind + '/' + demandBand(world));
  assert.equal(checkFeasible(world).success,true);
  drawn.add(choice.cell);
}
assert.ok(drawn.size > 1 && drawn.size <= CELLS.length);
console.log('Reproduced ' + published.trials.length + ' full training runs and ' + actual.outcomes.length + ' held-out outcomes.');
console.log('Verified ' + published.banks.reduce((s,b) => s + b.scenarios,0) + ' bank witnesses, ' +
  published.witnessAudit.successful + ' validation/test witnesses and 48 reproducible live challenges.');
