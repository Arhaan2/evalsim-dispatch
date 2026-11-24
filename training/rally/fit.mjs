import { prng } from "../protocol.mjs";
import { RALLY_PATTERNS, RALLY_SUITE, createRally, observeRally, stepRally } from "../../docs/lib/rally.js";
import { SURVEY_WAVES, publicState, surveyBin } from "../../docs/lib/rally-policy.js";

export const RALLY_FIT_SPEC = Object.freeze({
  seedsPerFit: 6000, blockSize: 12000, pseudocount: 0.5, targetWeight: 2, recoveryWeight: 3,
});

function sampleSeeds(randomSeed, start) {
  const { blockSize, seedsPerFit } = RALLY_FIT_SPEC;
  const draw = prng(randomSeed);
  const pool = Array.from({ length: blockSize }, (_, i) => start + i);
  for (let i = 0; i < seedsPerFit; i++) {
    const j = i + Math.floor(draw() * (blockSize - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, seedsPerFit);
}

function priorWeight(pattern, paired) {
  if (!paired && pattern.stratum === "interrupted-drop" && pattern.ending === "cold") return RALLY_FIT_SPEC.recoveryWeight;
  if ((pattern.stratum === "interrupted-drop" && pattern.ending === "hot") ||
      (pattern.stratum === "reversal" && pattern.ending === "cold")) return RALLY_FIT_SPEC.targetWeight;
  return 1;
}

function currentCounts(horizon) {
  return Array.from({ length: horizon }, () =>
    Array.from({ length: 18 }, () => ({ n: 0, hot: 0, next: new Float64Array(18) })));
}

function currentModel(counts) {
  const pseudo = RALLY_FIT_SPEC.pseudocount;
  return counts.map((states, wave) => states.map((row, state) => {
    const hot = (row.hot + pseudo) / (row.n + 2 * pseudo);
    if (wave === counts.length - 1) return { hot, next: [] };
    const survey = SURVEY_WAVES.includes(wave + 1);
    const denominator = row.n + (survey ? 18 : 2) * pseudo;
    const next = Array.from(row.next, (count, to) => {
      if (!survey && Math.floor(to / 2) !== Math.floor(state / 2)) return 0;
      return (count + pseudo) / denominator;
    });
    return { hot, next };
  }));
}

/**
 * The known training-market assignment groups repeated samples of that task.
 * The ending label annotates the persistence readout and the study's training
 * weights. Neither model reads the simulator's private probabilities, levels
 * or reward tape. The collection policy passes through all eight offers.
 */
export function fitRally(index, trainingSeed) {
  const { blockSize, seedsPerFit, pseudocount } = RALLY_FIT_SPEC;
  const bank = RALLY_SUITE.splits.train;
  if (!Number.isInteger(index) || index < 0 || (index + 1) * blockSize > bank.count) {
    throw new RangeError("Rally fit index is outside its training seed bank.");
  }
  const start = bank.start + index * blockSize;
  const seeds = sampleSeeds(trainingSeed, start);
  const horizon = observeRally(createRally({ seed: start, family: bank.families[0] })).horizon;
  const components = [], current = currentCounts(horizon);
  let totalWeight = 0;

  for (const family of bank.families) {
    const pattern = RALLY_PATTERNS[family], hot = pattern.ending === "hot";
    const paired = bank.families.includes(pattern.stem + "-hot") && bank.families.includes(pattern.stem + "-cold");
    const prior = priorWeight(pattern, paired);
    totalWeight += prior;
    const signedHigh = new Float64Array(horizon);
    const surveys = SURVEY_WAVES.map(() => new Float64Array(9));
    for (const seed of seeds) {
      const world = createRally({ seed, family });
      let o = observeRally(world), previous;
      while (!o.done) {
        const high = o.offer.net === o.quote.high;
        signedHigh[o.wave] += Number(high);
        const survey = SURVEY_WAVES.indexOf(o.wave);
        if (survey >= 0) surveys[survey][surveyBin(o.quote.highChance)]++;
        const state = publicState(o.quote, high), row = current[o.wave][state];
        row.n += prior;
        row.hot += Number(hot) * prior;
        if (previous) previous.next[state] += prior;
        previous = row;
        o = stepRally(world, "pass");
      }
    }
    components.push({
      prior, hot,
      signedHigh: Array.from(signedHigh, n => (n + pseudocount) / (seedsPerFit + 2 * pseudocount)),
      surveys: surveys.map(hist => Array.from(hist, n => (n + pseudocount) / (seedsPerFit + hist.length * pseudocount))),
    });
  }
  for (const c of components) c.prior /= totalWeight;
  const tapes = seeds.length * components.length;
  return {
    weights: { kind: "latent", components },
    ablatedWeights: { kind: "current", rows: currentModel(current) },
    trainingCounts: {
      trainingSeed, blockStart: start, blockSize, seeds: seeds.length, families: components.length,
      tapes, decisions: horizon * tapes, weightedTapes: totalWeight * seeds.length,
    },
  };
}
