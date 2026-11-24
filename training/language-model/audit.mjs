import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorld, makeScenario, step, verify } from '../../docs/lib/world.js';

const dir = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + '/') : new URL('../../docs/data/llm/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const results = await read('results.json');
const expectedCases = results.protocol.testFamilies.length * results.protocol.testSeedsPerFamily;
assert.equal(results.cases.length, expectedCases);
const modes = ['base', 'trained', 'dispatcher'];
for (const [i, row] of results.cases.entries()) {
  assert.equal(row.seed, results.protocol.testSeedStart + i);
  assert.equal(row.family, results.protocol.testFamilies[i % results.protocol.testFamilies.length]);
  for (const mode of modes) {
    const world = createWorld(makeScenario(row.seed, row.family));
    for (const action of row.actions[mode]) {
      assert.equal(world.done, false);
      step(world, action);
    }
    const result = verify(world);
    assert.equal(world.done, true);
    assert.deepEqual(result.violations, []);
    for (const [key, expected] of Object.entries(row[mode])) assert.equal(result[key], expected, mode+' '+key);
  }
}
for (const mode of modes) {
  const rows = results.cases.map(row => row[mode]);
  const total = key => rows.reduce((sum, row) => sum + Number(row[key]), 0);
  assert.deepEqual(results.summary[mode], { successes: total('success'), episodes: expectedCases, onTime: total('fulfilled'),
    demand: total('totalDemand'), spend: total('spend'), toolCalls: total('toolCalls'), rejections: total('rejectedActions') });
  const trace = await read('trace-'+mode+'.json');
  const row = results.cases.find(entry => entry.seed === trace.seed && entry.family === trace.family);
  assert.deepEqual(trace.trace.map(turn => turn.action), row.actions[mode]);
  assert.deepEqual(trace.metrics, row[mode]);
}
assert.deepEqual(results.validation.map(v => v.group), results.protocol.validationGroups);
for (const point of results.validation) {
  assert.equal(point.successes, point.metrics.filter(row => row.success).length);
  assert.equal(point.episodes, point.metrics.length);
  assert.equal(point.trainingCalls, results.training.slice(0,point.group).flatMap(g=>g.episodes).reduce((s,r)=>s+r.toolCalls,0));
}
console.log('Verified '+(expectedCases * modes.length)+' language-model benchmark rollouts and all three featured traces.');
