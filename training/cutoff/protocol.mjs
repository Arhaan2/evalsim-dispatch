// Declared before training or evaluation. Published test seeds become development data for future revisions.
export const SPEC = Object.freeze({
  version: "cutoff-v2.0", trainSeeds: [100000, 199999], validationStart: 200000, validationPairsPerFamily: 24,
  testStart: 300000, testPairsPerFamily: 48, probeStart: 400000, probePairsPerFamily: 4,
  trainingSeeds: [13, 37, 73, 101, 211], families: ["uncertain", "urgent"], callsPerBlock: 256,
  blocks: 16, target: 0.85, consecutiveCheckpoints: 2, stepSize: 0.03, explorationFloor: 0.15,
  reportCheckpointSeed: 13, bootstrapDraws: 1000,
});

export function casesFor(split) {
  if (!["validation", "test"].includes(split)) throw new RangeError("Unknown evaluation split.");
  const start = split === "test" ? SPEC.testStart : SPEC.validationStart;
  const count = split === "test" ? SPEC.testPairsPerFamily : SPEC.validationPairsPerFamily;
  return Array.from({ length: count }, (_, i) => SPEC.families.flatMap(family =>
    [0, 1].map(variant => ({ seed: start + i, split, family, variant })))).flat();
}
