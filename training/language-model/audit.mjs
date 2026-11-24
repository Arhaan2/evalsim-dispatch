import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld, makeScenario, step, verify } from '../../docs/lib/world.js';

const dir = new URL('../../docs/data/llm/', import.meta.url);
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
  const trace = await read('trace-'+mode+'.json');
  const row = results.cases.find(entry => entry.seed === trace.seed && entry.family === trace.family);
  assert.deepEqual(trace.trace.map(turn => turn.action), row.actions[mode]);
  assert.deepEqual(trace.metrics, row[mode]);
}
console.log('Verified '+(expectedCases * modes.length)+' language-model benchmark rollouts and all three featured traces.');
