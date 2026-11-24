import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const model = JSON.parse(await readFile(new URL('../protocol.json',import.meta.url),'utf8'));
export async function sourceHash() {
  const digest = createHash('sha256');
  const files = ['../protocol.json','../menu.mjs','../adapter.mjs','../worker.mjs','../encode.cpp',
    '../../../docs/lib/world.js','protocol.json','provenance.mjs','episode.mjs','credit.mjs','run.mjs'];
  for (const file of files) digest.update(file).update(await readFile(new URL(file,import.meta.url)));
  return digest.digest('hex');
}
export function summarize(rows) {
  const total = key => rows.reduce((sum,row) => sum + Number(row[key]),0);
  return {successes:total('success'),episodes:rows.length,onTime:total('fulfilled'),demand:total('totalDemand'),
    spend:total('spend'),toolCalls:total('toolCalls'),rejections:total('rejectedActions')};
}
