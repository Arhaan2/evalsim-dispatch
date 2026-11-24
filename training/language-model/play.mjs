import { readFile } from 'node:fs/promises';
import { createWorld, makeScenario, observe, step, verify } from '../../docs/lib/world.js';
import { choose, distribution, initAdapter, project, randomStream } from './adapter.mjs';
import { promptFor, toolMenu } from './menu.mjs';
import { openEncoder } from './worker.mjs';

const [binary, model, checkpoint, family, rawSeed] = process.argv.slice(2);
if (rawSeed === undefined || !/^\d+$/.test(rawSeed)) {
  throw new Error('Usage: node training/language-model/play.mjs <encoder> <model.gguf> <base|adapter.json> <family> <seed>');
}
const world = createWorld(makeScenario(Number(rawSeed), family));
const protocol = JSON.parse(await readFile(new URL('./protocol.json', import.meta.url)));
let adapter = checkpoint === 'base' ? null : JSON.parse(await readFile(checkpoint));
if (adapter && adapter.modelSha256 !== protocol.sha256) throw new Error('Checkpoint model checksum mismatch');
const worker = await openEncoder(binary, model, protocol.sha256);
try {
  while (!world.done) {
    const obs = observe(world);
    const menu = toolMenu(obs);
    let slot = [...menu.keys()][0];
    if (menu.size > 1) {
      const { logits, h } = await worker.encode(promptFor(obs, menu));
      adapter ??= initAdapter(h.length, randomStream(protocol.trainingSeed));
      const slots = [...menu.keys()];
      slot = slots[choose(distribution(logits, project(adapter,h), adapter, slots))];
    }
    const action = menu.get(slot);
    const outcome = step(world, action);
    console.log(JSON.stringify({ tick: obs.tick, action, message: outcome.message }));
  }
  console.log(JSON.stringify(verify(world)));
} finally { worker.close(); }
