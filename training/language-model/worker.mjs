import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

export async function openEncoder(binary, model, sha256) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(model)) digest.update(chunk);
  if (digest.digest('hex') !== sha256) throw new Error('Model checksum differs from protocol');
  const child = spawn(resolve(binary), [resolve(model)], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const kill = () => child.kill();
  process.once('exit', kill);
  return {
    async encode(prompt) {
      child.stdin.write(Buffer.byteLength(prompt) + '\n' + prompt);
      const line = await lines.next();
      if (line.done) throw new Error('Local model worker exited before returning logits');
      const data = JSON.parse(line.value);
      if (!data.logits.every(Number.isFinite) || !data.hidden.every(Number.isFinite) || data.hidden.length === 0) {
        throw new Error('Invalid decoder output');
      }
      return { logits: data.logits, h: Float32Array.from(data.hidden), evaluated: data.evaluated, tokens: data.tokens };
    },
    close() { child.stdin.end(); }
  };
}
