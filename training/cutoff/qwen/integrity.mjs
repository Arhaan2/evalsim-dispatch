import { readFile } from 'node:fs/promises';
import { hash } from './model.mjs';

const files = ['protocol.json', 'model.mjs', 'experiment.mjs', 'run.mjs', '../../language-model/worker.mjs',
  '../../language-model/adapter.mjs', '../../language-model/protocol.json', '../../language-model/encode.cpp',
  '../../../docs/lib/cutoff.js'];
export async function fingerprints() {
  return Object.fromEntries(await Promise.all(files.map(async path =>
    [path, hash(await readFile(new URL(path, import.meta.url)))])));
}
