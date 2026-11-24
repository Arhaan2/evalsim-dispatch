import { createFreightBenchmark } from "./freight-benchmark.js";
import { adaptivePlanner, createTrust, observeTrust, stepTrust, stochasticPlanner,
  TRUST_PATTERNS, TRUST_SUITE, trustCases, verifyTrust } from "./trust.js";
import { chooseTrust } from "./trust-policy.js";
import { chooseCloses } from "./closes-policy.js";
import { chooseDrift } from "./drift-policy.js";
import { chooseTurns } from "./turns-policy.js";

export const TRUST_REPORT = "evalsim-trust-report-v1";
export const TRUST_EVALUATION_SPLITS = Object.freeze(["validation", "test", "retention", "archive"]);

export function trustWeights(release, closes, drift, turns) {
  const { weights, binaryWeights, votesWeights } = release.checkpoint;
  return { trust: weights, binary: binaryWeights, votes: votesWeights,
    closes: closes.checkpoint.weights, drift: drift.checkpoint.weights, turns: turns.checkpoint.weights };
}

export const trustReferences = weights => ({
  rl: observation => chooseTrust(observation, weights.trust, weights),
  binary: observation => chooseTrust(observation, weights.binary, weights),
  votes: observation => chooseTrust(observation, weights.votes, weights),
  closes: observation => chooseCloses(observation, weights.closes),
  stochastic: stochasticPlanner,
  drift: observation => chooseDrift(observation, weights.drift),
  turns: observation => chooseTurns(observation, weights.turns),
  adaptive: adaptivePlanner,
});

export const { runCase: runTrustCase, benchmark: benchmarkTrust, verifyReport: verifyTrustReport } =
  createFreightBenchmark({
    id: TRUST_SUITE.id, format: TRUST_REPORT, cases: trustCases, references: trustReferences,
    splits: TRUST_EVALUATION_SPLITS, stratum: family => TRUST_PATTERNS[family].stratum,
    ending: family => TRUST_PATTERNS[family].ending,
    world: { create: createTrust, observe: observeTrust, step: stepTrust, verify: verifyTrust },
  });
