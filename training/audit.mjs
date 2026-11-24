/** Verify published checkpoints using only the artifacts in the public repository. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeScenario, createWorld, feasiblePlan, step, verify} from '../docs/lib/world.js';
import {evaluate, signature} from './run.mjs';
import {CHECKPOINTS, FINAL_TEST, HELD_OUT, REPLICATES, VALIDATION} from './protocol.mjs';

const read = async name => JSON.parse(await readFile(new URL('../docs/data/' + name, import.meta.url), 'utf8'));
const experiment = await read('experiment.json');
assert.equal(await signature(), experiment.signature, 'Source fingerprint differs from the published run.');
const checkpoints = await read('checkpoints.json');
const expected = await read('test-outcomes.json');
const policies = [
  {id:'untrained', replicate:null, policy:checkpoints.untrained},
  {id:'dispatcher', replicate:null, policy:'dispatcher'},
  ...checkpoints.replicates.map(entry => ({id:entry.mode, replicate:entry.seed, policy:entry.policy})),
];
assert.equal(policies.length, 2 + 2 * REPLICATES.length);
assert.equal(expected.length, policies.length * FINAL_TEST.length);
for (const [key, mode] of [['trained','adaptive'], ['uniform','uniform']]) {
  const published = checkpoints.replicates.find(item => item.mode === mode && item.seed === REPLICATES[0]);
  assert.deepEqual(checkpoints[key], published.policy, 'Demo checkpoint is from the wrong replicate.');
  assert.deepEqual(checkpoints.history.at(-1)[key], published.policy, 'Last history checkpoint differs.');
  assert.deepEqual(checkpoints.history[0][key], checkpoints.untrained, 'Initial checkpoint differs.');
}
assert.deepEqual(checkpoints.history.map(entry => entry.episodes), CHECKPOINTS);

const metrics = ['fulfillment', 'success', 'cost', 'toolCalls', 'violations'];
function checkSummary(rows, summary) {
  for (const metric of metrics) {
    const mean = rows.reduce((sum, row) => sum + row[metric], 0) / rows.length;
    assert.equal(summary[metric], Number(mean.toFixed(6)), 'Published mean differs for ' + metric);
  }
}
for (const summary of experiment.summary) {
  const selected = expected.filter(row => row.id === summary.id);
  checkSummary(selected, summary);
  checkSummary(selected, summary.all);
  checkSummary(selected.filter(row => HELD_OUT.includes(row.kind)), summary.unseenFamilies);
  checkSummary(selected.filter(row => !HELD_OUT.includes(row.kind)), summary.unseenSeeds);
}

for (const entry of policies) {
  const actual = evaluate(FINAL_TEST, entry.policy).map(row => ({id:entry.id, replicate:entry.replicate, ...row}));
  const match = expected.filter(row => row.id === entry.id && row.replicate === entry.replicate);
  assert.deepEqual(actual, match, 'Published per-case outcomes differ from replay.');
}
// This omniscient witness is isolated from checkpoint inference above.
for (const entry of [...VALIDATION, ...FINAL_TEST]) {
  const world = createWorld(makeScenario(entry.seed, entry.kind));
  while (!world.done) step(world, feasiblePlan(world));
  assert.equal(verify(world).success, true, 'No feasibility witness succeeded for ' + JSON.stringify(entry));
}
console.log('Reproduced ' + expected.length + ' published outcomes across ' + FINAL_TEST.length + ' test cases.');
console.log('Verified feasible witness schedules for all ' + (VALIDATION.length + FINAL_TEST.length) + ' validation and test scenarios.');
