import { prng } from "../protocol.mjs";
import { TRUST_PATTERNS, TRUST_SUITE, createTrust, observeTrust, stepTrust } from "../../docs/lib/trust.js";
import { expertMask, extendTrustKeys, trustKeys } from "../../docs/lib/trust-policy.js";
import { SPEC } from "./protocol.mjs";

function sampledSeeds(trainingSeed, start) {
  const random = prng(trainingSeed);
  const pool = Array.from({ length: SPEC.blockSize }, (_, i) => start + i);
  for (let i = 0; i < SPEC.seedsPerFit; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, SPEC.seedsPerFit);
}

function intern(layer, o, mask) {
  const keys = trustKeys(o, mask);
  const baseLength = keys.length;
  extendTrustKeys(keys, o.history);
  let parent = -1, base;
  for (const [i, key] of keys.entries()) {
    if (!layer.index.has(key)) {
      layer.index.set(key, layer.nodes.length);
      layer.nodes.push({ key, parent });
    }
    parent = layer.index.get(key);
    if (i === baseLength - 1) base = parent;
  }
  return { full: parent, base };
}

// Freight demand is exogenous. Passing through the shift reveals the same
// signed freight as booking. Construct feasible expert advice for each truck
// count at the same public observation without exposing the future market.
export function collect(index, trainingSeed, experts) {
  const train = TRUST_SUITE.splits.train;
  const start = train.start + index * SPEC.blockSize;
  const seeds = sampledSeeds(trainingSeed, start);
  const n = seeds.length * train.families.length;
  const sampleWeight = new Uint8Array(n);
  const horizon = observeTrust(createTrust({ seed: start, family: train.families[0] })).horizon;
  const layers = Array.from({ length: horizon }, () => ({
    net: new Int16Array(n), capacity: Array.from({ length: 2 }, () => ({
      nodes: [], index: new Map(), mask: new Uint8Array(n),
      full: new Int32Array(n), binary: new Int32Array(n), votes: new Int32Array(n),
    })),
  }));
  let i = 0, effectiveShifts = 0;
  for (const seed of seeds) {
    for (const family of train.families) {
      const state = createTrust({ seed, family });
      const pattern = TRUST_PATTERNS[family];
      sampleWeight[i] = pattern.ending === "hot" && pattern.stratum === "interrupted-drop" ? SPEC.hotDropWeight : 1;
      effectiveShifts += sampleWeight[i];
      let o = observeTrust(state);
      while (!o.done) {
        const wave = layers[o.wave];
        wave.net[i] = o.offer.net;
        for (let c = 1; c <= 2; c++) {
          const layer = wave.capacity[c - 1];
          const view = { ...o, slots: c };
          const mask = expertMask(view, experts, true);
          layer.mask[i] = mask;
          if (mask === 0 || mask === 7) continue;
          const ids = intern(layer, view, mask);
          layer.full[i] = ids.full;
          layer.votes[i] = ids.base;
          const binary = mask & 3;
          if (binary !== 0 && binary !== 3) layer.binary[i] = binary === mask ? ids.full : intern(layer, view, binary).full;
        }
        o = stepTrust(state, "pass");
      }
      i++;
    }
  }
  return { layers, sampleWeight, n, start, effectiveShifts };
}

// Work backward through the decision times. At a disagreement, booking now
// earns x plus the downstream policy's realized return with one fewer truck.
// Passing earns the downstream return with the current truck count. Fit the
// difference over similar observations, then roll out the fitted decision.
export function fit(data, kind) {
  const { layers, sampleWeight, n } = data;
  const weights = { history: kind !== "votes", specialist: kind !== "binary", tables: Array(layers.length) };
  const all = weights.specialist ? 7 : 3;
  let next = [new Int16Array(n), new Int16Array(n), new Int16Array(n)];
  for (let t = layers.length - 1; t >= 0; t--) {
    const wave = layers[t], current = [next[0], new Int16Array(n), new Int16Array(n)];
    weights.tables[t] = [];
    for (let c = 1; c <= 2; c++) {
      const layer = wave.capacity[c - 1], ids = layer[kind];
      const count = new Uint32Array(layer.nodes.length), value = new Float64Array(count.length);
      for (let i = 0; i < n; i++) {
        const mask = layer.mask[i] & all;
        if (mask === 0 || mask === all) continue;
        const id = ids[i], w = sampleWeight[i];
        count[id] += w;
        value[id] += w * (wave.net[i] + next[c - 1][i] - next[c][i]);
      }
      for (let id = count.length - 1; id > 0; id--) {
        const parent = layer.nodes[id].parent;
        count[parent] += count[id];
        value[parent] += value[id];
      }
      const table = {};
      for (const [id, { key, parent }] of layer.nodes.entries()) {
        if (!count[id]) continue;
        const pseudo = parent < 0 ? 0 : SPEC.shrinkage;
        value[id] = Number(((value[id] + pseudo * (value[parent] ?? 0)) / (count[id] + pseudo)).toFixed(SPEC.decimals));
        table[key] = value[id];
      }
      weights.tables[t].push(table);
      for (let i = 0; i < n; i++) {
        const mask = layer.mask[i] & all, delta = value[ids[i]];
        const accept = mask === all || (mask !== 0 && (delta > 0 || (delta === 0 && (mask & 1))));
        current[c][i] = accept ? wave.net[i] + next[c - 1][i] : next[c][i];
      }
    }
    next = current;
  }
  return weights;
}
