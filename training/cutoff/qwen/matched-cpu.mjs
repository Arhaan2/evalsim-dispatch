import { readFile } from 'node:fs/promises';
import { chooseCutoff } from '../../../docs/lib/cutoff-policy.js';
import { cases, episode, protocol as p } from './experiment.mjs';
import { hash } from './model.mjs';

// Run the already-selected small CPU policies on the exact Qwen test slice.
export async function matchedCpu() {
  const url = new URL('../../../docs/data/cutoff/results.json', import.meta.url);
  const raw = await readFile(url);
  const suite = cases(p.testStart, p.testSeeds, 'test');
  const cpu = JSON.parse(raw);
  const runs = [];
  for (const { seed, mode, weights } of cpu.runs) {
    let successes = 0, calls = 0;
    for (const spec of suite) {
      const row = await episode(spec, obs => ({ action: chooseCutoff(obs, weights) }));
      successes += Number(row.metrics.success);
      calls += row.metrics.calls;
    }
    runs.push({ seed, mode, successes, calls });
  }
  return { testCases: suite.length, sourceSha256: hash(raw), runs };
}
