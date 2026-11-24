import { prng } from "../protocol.mjs";
import { createSurvey, observeSurvey, stepSurvey, SURVEY_PATTERNS, SURVEY_SUITE } from "../../docs/lib/survey.js";
import { forecastPath, lookup, mixSlotCosts, returnPath, surveyProbability } from "../../docs/lib/survey-policy.js";

export const FIT_SPEC = Object.freeze({ blockSize: 12000, fitSeeds: 2000, calibrationSeeds: 1000,
  rawPrior: 64, calibrationPrior: 32, returnPrior: 64, targetWeight: 4, recoveryWeight: 6 });

function drawSeeds(start, seed) {
  const draw = prng(seed), n = FIT_SPEC.fitSeeds + FIT_SPEC.calibrationSeeds;
  const bank = Array.from({ length: FIT_SPEC.blockSize }, (_, i) => start + i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(draw() * (bank.length - i));
    [bank[i], bank[j]] = [bank[j], bank[i]];
  }
  return [bank.slice(0, FIT_SPEC.fitSeeds), bank.slice(FIT_SPEC.fitSeeds, n)];
}

function trainingGroups(families) {
  const fit = [], calibration = [], stems = new Map();
  for (const family of families) {
    const p = SURVEY_PATTERNS[family];
    if (!families.includes(p.stem + "-hot") || !families.includes(p.stem + "-cold")) {
      fit.push({ family, hot: Number(p.ending === "hot"), paired: false, priority: FIT_SPEC.recoveryWeight });
      continue;
    }
    if (!stems.has(p.stratum)) stems.set(p.stratum, []);
    const group = stems.get(p.stratum);
    if (!group.includes(p.stem)) group.push(p.stem);
    const calibrate = (group.indexOf(p.stem) + 1) % 4 === 0;
    const target = p.stratum === "interrupted-drop" ? p.ending === "hot" : p.ending === "cold";
    (calibrate ? calibration : fit).push({ family, hot: Number(p.ending === "hot"), paired: true,
      priority: target ? FIT_SPEC.targetWeight : 1 });
  }
  return { fit, calibration };
}

function collect(seeds, markets) {
  const tapes = [], boards = new Map();
  for (const market of markets) for (const seed of seeds) {
    let bits = 0, first = 0, second = 0;
    const state = createSurvey({ seed, family: market.family });
    let o = observeSurvey(state);
    const quotes = [o.quote, ...o.forecast];
    const key = quotes.map(q => q.low + "/" + q.high).join(",");
    if (!boards.has(key)) boards.set(key, { id: boards.size, prices: quotes.map(q => [q.low, q.high]) });
    while (!o.done) {
      if (o.offer.net === o.quote.high) bits |= 1 << o.wave;
      if (o.wave === 3) first = Math.round(o.quote.highChance * 10);
      if (o.wave === 6) second = Math.round(o.quote.highChance * 10);
      o = stepSurvey(state, "pass");
    }
    tapes.push({ board: boards.get(key), bits, first, second, hot: market.hot, paired: market.paired, priority: market.priority });
  }
  return tapes;
}

// Share repeated public prefixes across tapes. Each terminal label stays on
// the training side of the estimator and is never part of an evidence key.
function makeLayer(tapes, wave) {
  const keys = new Map(), evidence = [], ids = new Uint32Array(tapes.length);
  const prices = new Int16Array(tapes.length), mask = (1 << (wave + 1)) - 1;
  for (let i = 0; i < tapes.length; i++) {
    const tape = tapes[i], bits = tape.bits & mask;
    const first = wave >= 3 ? tape.first : 0, second = wave >= 6 ? tape.second : 0;
    const key = bits + 256 * (first + 10 * second + 100 * tape.board.id);
    if (!keys.has(key)) {
      keys.set(key, evidence.length);
      const [low, high] = tape.board.prices[wave];
      evidence.push({ signal: { wave, bits, first, second, low, high }, counts: [0, 0] });
    }
    const id = keys.get(key);
    ids[i] = id;
    const { signal, counts } = evidence[id];
    prices[i] = (bits >> wave) & 1 ? signal.high : signal.low;
    if (tape.paired) counts[tape.hot]++;
  }
  return { ids, prices, evidence };
}

function rawForecast(groups, surveys) {
  const cells = new Map();
  for (const { signal, counts } of groups) {
    if (!(counts[0] + counts[1])) continue;
    let parent = null;
    for (const key of forecastPath(signal, surveys)) {
      if (!cells.has(key)) cells.set(key, { parent, hot: 0, n: 0 });
      const cell = cells.get(key);
      cell.hot += counts[1];
      cell.n += counts[0] + counts[1];
      parent = key;
    }
  }
  const raw = {};
  for (const [key, cell] of cells) {
    const prior = cell.parent === null ? 0.5 : raw[cell.parent];
    raw[key] = (cell.hot + FIT_SPEC.rawPrior * prior) / (cell.n + FIT_SPEC.rawPrior);
  }
  return raw;
}

// Pool adjacent calibration bins that violate monotonicity. A smoothing
// prior centered on the raw probability regularizes sparsely sampled bins.
function calibrationCurve(raw, groups, surveys) {
  const bins = Array.from({ length: 10 }, () => ({ sum: 0, n: 0, hot: 0 }));
  for (const { signal, counts } of groups) {
    const p = lookup(raw, forecastPath(signal, surveys)), n = counts[0] + counts[1];
    const b = bins[Math.min(9, Math.floor(10 * p))];
    b.sum += p * n;
    b.n += n;
    b.hot += counts[1];
  }
  const blocks = [];
  for (const [bin, b] of bins.entries()) {
    const prior = b.n ? b.sum / b.n : (bin + 0.5) / 10;
    const block = { lo: bin, hi: bin, n: b.n + FIT_SPEC.calibrationPrior, hot: b.hot + prior * FIT_SPEC.calibrationPrior };
    while (blocks.length) {
      const previous = blocks.at(-1);
      if (previous.hot / previous.n <= block.hot / block.n) break;
      blocks.pop();
      block.lo = previous.lo;
      block.n += previous.n;
      block.hot += previous.hot;
    }
    blocks.push(block);
  }
  const curve = [];
  for (const b of blocks) for (let i = b.lo; i <= b.hi; i++) curve[i] = b.hot / b.n;
  return curve;
}

function fitForecast(layers, calibration, surveys) {
  return layers.map((layer, wave) => {
    const useSurvey = surveys && wave >= 3;
    const raw = rawForecast(layer.evidence, useSurvey);
    return { raw, curve: calibrationCurve(raw, calibration[wave].evidence, useSurvey) };
  });
}

// Learn marginal rewards of retaining truck slots, separately for hot/cold
// endings, under THIS variant's downstream policy. On these exogenous tapes
// the realized continuation with c and c-1 slots is available for each c.
function fitReturns(model, tapes, layers) {
  let one = new Int16Array(tapes.length), two = new Int16Array(tapes.length);
  model.returns = Array(layers.length);
  for (let wave = layers.length - 1; wave >= 0; wave--) {
    const { evidence, ids, prices } = layers[wave];
    const registry = new Map(), nodes = [], leaves = [];
    for (const { signal } of evidence) {
      let parent = -1;
      for (const key of returnPath(signal, model.kind !== "never")) {
        if (!registry.has(key)) {
          registry.set(key, nodes.length);
          nodes.push({ key, parent, sums: new Float64Array(8) });
        }
        parent = registry.get(key);
      }
      leaves.push(parent);
    }
    for (let i = 0; i < tapes.length; i++) {
      const { hot, priority } = tapes[i], j = 4 * hot;
      const sums = nodes[leaves[ids[i]]].sums;
      sums[j]++;
      sums[j + 1] += priority;
      sums[j + 2] += priority * one[i];
      sums[j + 3] += priority * (two[i] - one[i]);
    }
    for (let i = nodes.length - 1; i > 0; i--) {
      const node = nodes[i], parent = nodes[node.parent];
      for (let j = 0; j < 8; j++) parent.sums[j] += node.sums[j];
    }
    const table = {};
    for (const { key, parent, sums } of nodes) {
      const row = [], prior = parent < 0 ? 0 : FIT_SPEC.returnPrior;
      const base = parent < 0 ? [1,0,0,1,0,0] : table[nodes[parent].key];
      for (let hot = 0; hot < 2; hot++) {
        const j = 4 * hot, k = 3 * hot;
        const n = sums[j], weight = sums[j+1];
        row.push((weight + prior * base[k]) / (n + prior));
        for (let c = 1; c <= 2; c++) row.push((sums[j + 1 + c] + prior * base[k] * base[k+c]) / (weight + prior * base[k]));
      }
      table[key] = row;
    }
    model.returns[wave] = table;
    const costs = evidence.map(({ signal }, id) =>
      mixSlotCosts(surveyProbability(signal, model), table[nodes[leaves[id]].key]));
    const newOne = new Int16Array(tapes.length), newTwo = new Int16Array(tapes.length);
    for (let i = 0; i < tapes.length; i++) {
      const cost = costs[ids[i]], x = prices[i];
      newOne[i] = x >= cost.one ? x : one[i];
      newTwo[i] = x >= cost.two ? x + one[i] : two[i];
    }
    one = newOne;
    two = newTwo;
  }
  return model;
}

export function fitSurvey(index, trainingSeed) {
  const bank = SURVEY_SUITE.splits.train;
  if (!Number.isInteger(index) || index < 0 || (index + 1) * FIT_SPEC.blockSize > bank.count) throw new RangeError("Unknown survey fit block.");
  const start = bank.start + index * FIT_SPEC.blockSize;
  const [fitSeeds, calSeeds] = drawSeeds(start, trainingSeed);
  const { fit, calibration } = trainingGroups(bank.families);
  const tapes = collect(fitSeeds, fit), held = collect(calSeeds, calibration);
  const layers = Array.from({ length: 8 }, (_, wave) => makeLayer(tapes, wave));
  const heldLayers = layers.map((_, wave) => makeLayer(held, wave));
  const full = fitForecast(layers, heldLayers, true), signed = fitForecast(layers, heldLayers, false);
  const weights = fitReturns({ kind: "learned", forecast: full }, tapes, layers);
  // Both controls share the signed-only forecast estimator on these tapes.
  // The always-trust rule needs it only before the first delayed bulletin.
  const alwaysWeights = fitReturns({ kind: "always", forecast: signed.slice(0, 3) }, tapes, layers);
  const neverWeights = fitReturns({ kind: "never", forecast: signed }, tapes, layers);
  const native = fit.filter(f => f.paired).length;
  const trainingCounts = { trainingSeed, blockStart: start, blockSize: FIT_SPEC.blockSize,
    fitSeeds: fitSeeds.length, calibrationSeeds: calSeeds.length, fitStems: native / 2, calibrationStems: calibration.length / 2,
    forecastTapes: native * fitSeeds.length, calibrationTapes: held.length, controlTapes: tapes.length, controlDecisions: tapes.length * 8,
    weightedControlTapes: fitSeeds.length * fit.reduce((n, p) => n + p.priority, 0),
    fitFamilies: fit.map(p => p.family), calibrationFamilies: calibration.map(p => p.family) };
  return { weights, alwaysWeights, neverWeights, trainingCounts };
}
