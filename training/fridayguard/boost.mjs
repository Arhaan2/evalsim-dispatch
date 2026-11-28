import assert from "node:assert/strict";
import {treeValue} from "../../docs/lib/longmove-policy.js";
import {guardOutcomes} from "../../docs/lib/fridayguard-policy.js";

export const treeSettings = {rounds:48, depth:2, bins:16, rate:.1, minLeaf:48, l2:12};
const round = n => Number(n.toFixed(12));

function quantize(rows, count) {
  return rows[0].x.map((_, j) => {
    const sorted = rows.map(row => row.x[j]).sort((a, b) => a - b);
    const thresholds = new Set();
    for (let k = 1; k < count; k++) {
      const cut = sorted[Math.max(0, Math.floor(rows.length * k / count) - 1)];
      if (cut < sorted.at(-1)) thresholds.add(cut);
    }
    const cuts = [...thresholds];
    const bins = Uint8Array.from(rows, row => {
      let bin = 0;
      while (bin < cuts.length && row.x[j] > cuts[bin]) bin++;
      return bin;
    });
    return {cuts, bins};
  });
}

function grow(indices, residual, columns, depth, cfg) {
  let total = 0;
  for (const i of indices) total += residual[i];
  const size = indices.length;
  const leaf = () => ({value:round(total / (size + cfg.l2))});
  if (!depth || size < 2 * cfg.minLeaf) return leaf();
  const parentGain = total ** 2 / (size + cfg.l2);
  let best = null, bestGain = 1e-10;
  for (const [j, {cuts, bins}] of columns.entries()) {
    if (!cuts.length) continue;
    const counts = new Uint32Array(cuts.length + 1), sums = new Float64Array(cuts.length + 1);
    for (const i of indices) {const b = bins[i]; counts[b]++; sums[b] += residual[i];}
    let n = 0, sum = 0;
    for (let b = 0; b < cuts.length; b++) {
      n += counts[b]; sum += sums[b];
      if (n < cfg.minLeaf || size - n < cfg.minLeaf) continue;
      const gain = sum ** 2 / (n + cfg.l2) + (total - sum) ** 2 / (size - n + cfg.l2) - parentGain;
      if (gain > bestGain + 1e-10) {best = {feature:j, bin:b}; bestGain = gain;}
    }
  }
  if (!best) return leaf();
  const column = columns[best.feature], left = [], right = [];
  for (const i of indices) (column.bins[i] <= best.bin ? left : right).push(i);
  return {feature:best.feature, cut:column.cuts[best.bin],
    left:grow(left, residual, columns, depth - 1, cfg), right:grow(right, residual, columns, depth - 1, cfg)};
}

export function fitHeads(rows, cfg = treeSettings) {
  assert(rows.length >= cfg.minLeaf, "Too few paired training examples");
  const columns = quantize(rows, cfg.bins), ids = rows.map((_, i) => i);
  return Object.fromEntries(guardOutcomes.map(name => {
    const bias = round(rows.reduce((sum, row) => sum + row[name], 0) / rows.length);
    const residual = rows.map(r => r[name] - bias), trees = [];
    for (let t = 0; t < cfg.rounds; t++) {
      const tree = grow(ids, residual, columns, cfg.depth, cfg);
      trees.push(tree);
      for (const i of ids) residual[i] -= cfg.rate * treeValue(tree, rows[i].x);
    }
    return [name, {bias, rate:cfg.rate, trees}];
  }));
}
