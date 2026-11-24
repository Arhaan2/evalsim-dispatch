// A rank-four residual on the eight legal token logits of the frozen language model.
export const LABELS = 'ABCDEFGH';
export const RANK = 4;

export function randomStream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}

export function initAdapter(size, random) {
  const input = Array.from({ length: RANK * size }, () => (random() * 2 - 1) * Math.sqrt(3));
  return { size, rank: RANK, input, output: Array(LABELS.length * RANK).fill(0) };
}

export function project(adapter, hidden) {
  if (adapter.size !== hidden.length) throw new Error('Mismatched model dimension');
  const scale = 1 / Math.sqrt(hidden.length);
  return Array.from({ length: RANK }, (_, k) => {
    let sum = 0;
    for (let d = 0; d < hidden.length; d++) sum += adapter.input[k * hidden.length + d] * hidden[d];
    return sum * scale;
  });
}

export function distribution(base, projected, adapter, slots, temperature = 1) {
  const scores = slots.map((slot) => {
    let score = base[slot];
    for (let k = 0; k < RANK; k++) score += adapter.output[slot * RANK + k] * projected[k];
    return score / temperature;
  });
  const max = Math.max(...scores);
  const values = scores.map(score => Math.exp(score - max));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => value / total);
}

export function choose(probs, random) {
  if (!random) return probs.indexOf(Math.max(...probs));
  let remaining = random();
  for (let i = 0; i < probs.length - 1; i++) {
    remaining -= probs[i];
    if (remaining <= 0) return i;
  }
  return probs.length - 1;
}

// Each trajectory contributes the sum of the gradients of its sampled log probabilities.
// The group shares one scenario. Subtract the mean return of the other two trajectories.
export function update(adapter, group, optimizer, temperature) {
  const grad = { input: new Float64Array(adapter.input.length), output: new Float64Array(adapter.output.length) };
  const sum = group.reduce((n, episode) => n + episode.reward, 0);
  for (const episode of group) {
    const advantage = episode.reward - (sum - episode.reward) / (group.length - 1);
    for (const record of episode.records) {
      const dz = Array(RANK).fill(0);
      record.slots.forEach((slot, i) => {
        const error = advantage * (Number(i === record.chosen) - record.probs[i]) / (temperature * group.length);
        for (let k = 0; k < RANK; k++) {
          grad.output[slot * RANK + k] += error * record.z[k];
          dz[k] += error * adapter.output[slot * RANK + k];
        }
      });
      for (let k = 0; k < RANK; k++) {
        const factor = dz[k] / Math.sqrt(adapter.size);
        for (let d = 0; d < adapter.size; d++) grad.input[k * adapter.size + d] += factor * record.h[d];
      }
    }
  }
  optimizer.steps++;
  for (const key of ['input', 'output']) {
    const state = optimizer[key] ??= {
      m: Array(adapter[key].length).fill(0), v: Array(adapter[key].length).fill(0)
    };
    const rate = key === 'input' ? 0.004 : 0.035;
    for (let i = 0; i < grad[key].length; i++) {
      const g = grad[key][i];
      state.m[i] = 0.9 * state.m[i] + 0.1 * g;
      state.v[i] = 0.999 * state.v[i] + 0.001 * g * g;
      const m = state.m[i] / (1 - 0.9 ** optimizer.steps);
      const v = state.v[i] / (1 - 0.999 ** optimizer.steps);
      adapter[key][i] += rate * m / (Math.sqrt(v) + 1e-8);
    }
  }
}
