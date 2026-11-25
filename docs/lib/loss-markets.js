// Symbols name depots before each week's random depot relabeling.
export const LOSS_PATTERNS = Object.freeze({
  "loss-early-relay": "0110022210",
  "loss-home-relay": "0001221100",
  "loss-return-bridge": "0011001220",
  "loss-long-relay": "0001112212",
  "loss-market-rebound": "0112220010",
  "loss-split-homecoming": "0012100110",
});

export const LOSS_FAMILIES = Object.freeze({
  validation: Object.freeze(["loss-early-relay", "loss-home-relay"]),
  test: Object.freeze(["loss-return-bridge", "loss-long-relay", "loss-market-rebound", "loss-split-homecoming"]),
  archive: Object.freeze(["double-return"]),
});
