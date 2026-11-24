import { readFile } from 'node:fs/promises';
import { initAdapter, randomStream } from '../../language-model/adapter.mjs';
import { openEncoder } from '../../language-model/worker.mjs';
import { model, modelAction, episode, protocol } from './experiment.mjs';
import { hash } from './model.mjs';

const [binary, weights, seedText, family = 'uncertain', variantText = '0', stage = 'rl', replicateText = '0'] = process.argv.slice(2);
if (!weights || !seedText || !['rl', 'sft', 'frozen'].includes(stage)) {
  throw new Error('Usage: node play.mjs ENCODER MODEL SEED [uncertain|urgent] [0|1] [frozen|sft|rl] [replicate index 0|1|2]');
}
const index = Number(replicateText);
if (!Number.isInteger(index) || index < 0 || index >= protocol.replicates.length) throw new Error('Invalid training replicate index.');
const reportUrl = new URL('../../../docs/data/cutoff/qwen.json', import.meta.url);
const report = JSON.parse(await readFile(reportUrl));
let adapter;
if (stage === 'frozen') adapter = initAdapter(2560, randomStream(0));
else {
  const checkpoint = report.checkpoints[index][stage];
  const bytes = await readFile(new URL('qwen/' + checkpoint.file, reportUrl));
  if (hash(bytes) !== checkpoint.sha256) throw new Error('Checkpoint checksum differs.');
  adapter = JSON.parse(bytes);
}
const encoder = await openEncoder(binary, weights, model.sha256);
try {
  const spec = { seed: Number(seedText), variant: Number(variantText), family, split: 'test' };
  const result = await episode(spec, (o, calls) => modelAction(o, calls, adapter, encoder));
  console.log(JSON.stringify(result, null, 2));
} finally { encoder.close(); }
