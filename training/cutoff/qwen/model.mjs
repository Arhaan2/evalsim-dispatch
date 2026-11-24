import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LABELS, distribution, project } from '../../language-model/adapter.mjs';

const labels = ['inspect', 'express-0', 'express-1', 'local-0', 'local-1', 'wait'];
export const hash = data => createHash('sha256').update(data).digest('hex');
export const slotsFor = calls => calls.map(call => {
  const slot = labels.indexOf(call.id);
  if (slot < 0) throw new Error('Unknown cutoff call: ' + call.id);
  return slot;
});

export function prompt(obs, calls) {
  const slots = slotsFor(calls);
  const menu = calls.map((action, i) => LABELS[slots[i]] + ' ' + action.label).join('\n');
  return '<|im_start|>system\nYou dispatch freight. Deliver both orders in full on time, within budget. '
    + 'Both destination yards serve their own account. There is one shared express truck and one shared local truck. '
    + 'Inspection costs time and one credit. Choose one offered tool. Answer with only its letter.<|im_end|>\n'
    + '<|im_start|>user\nPublic shift report\n' + JSON.stringify(obs)
    + '\nAvailable calls\n' + menu + '<|im_end|>\n<|im_start|>assistant\n';
}

// Each cache entry stores an actual frozen decoder output keyed by the full prompt and model.
export async function cachedEncoder(encoder, directory, modelId) {
  const folder = join(directory, modelId);
  await mkdir(folder, { recursive: true });
  const counts = { requests: 0, forwardPasses: 0, promptTokens: 0, evaluatedTokens: 0, cacheHits: 0 };
  return {
    counts,
    async encode(text) {
      counts.requests++;
      const file = join(folder, hash(text) + '.json');
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        counts.cacheHits++;
        return { logits: data.logits, h: Float32Array.from(data.h) };
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      const output = await encoder.encode(text);
      counts.forwardPasses++;
      counts.promptTokens += output.tokens;
      counts.evaluatedTokens += output.evaluated;
      await writeFile(file + '.' + process.pid, JSON.stringify({ logits: output.logits, h: [...output.h] }));
      await rename(file + '.' + process.pid, file);
      return output;
    }
  };
}

export function probabilities(adapter, representation, slots, temperature) {
  const z = project(adapter, representation.h);
  const probs = distribution(representation.logits, z, adapter, slots, temperature);
  return { slots, probs, z, h: representation.h };
}

// Cross-entropy against a demonstration's executed action, using the same legal mask as RL.
export function imitate(adapter, batch, state) {
  const gradients = { input: new Float64Array(adapter.input.length), output: new Float64Array(adapter.output.length) };
  for (const { representation, slots, target } of batch) {
    const { h, z, probs } = probabilities(adapter, representation, slots, 1);
    const dz = new Float64Array(adapter.rank);
    for (let i = 0; i < slots.length; i++) {
      const error = (Number(i === target) - probs[i]) / batch.length;
      for (let k = 0; k < adapter.rank; k++) {
        const at = slots[i] * adapter.rank + k;
        gradients.output[at] += error * z[k];
        dz[k] += error * adapter.output[at];
      }
    }
    for (let k = 0; k < adapter.rank; k++) {
      const factor = dz[k] / Math.sqrt(adapter.size);
      for (let d = 0; d < adapter.size; d++) gradients.input[k * adapter.size + d] += factor * h[d];
    }
  }
  state.steps++;
  for (const key of ['input', 'output']) {
    const rate = key === 'input' ? 0.004 : 0.035;
    const moments = state[key] ??= { m: new Float64Array(adapter[key].length), v: new Float64Array(adapter[key].length) };
    for (let i = 0; i < adapter[key].length; i++) {
      const g = gradients[key][i];
      moments.m[i] = 0.9 * moments.m[i] + 0.1 * g;
      moments.v[i] = 0.999 * moments.v[i] + 0.001 * g * g;
      const m = moments.m[i] / (1 - 0.9 ** state.steps);
      const v = moments.v[i] / (1 - 0.999 ** state.steps);
      adapter[key][i] += rate * m / (Math.sqrt(v) + 1e-8);
    }
  }
}
