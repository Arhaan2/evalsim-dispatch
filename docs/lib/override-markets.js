// Symbols are relative depots. Rotation and handedness are sampled independently each week.
export const OVERRIDE_TRAIN_PATTERNS = Object.freeze({
  "split-return": "0011102200",
  "long-home-market": "0001122000",
  "second-home-market": "0110022110",
  "return-via-inland": "0012211000",
});
export const OVERRIDE_TRAIN_FAMILIES = Object.freeze(Object.keys(OVERRIDE_TRAIN_PATTERNS));

export const OVERRIDE_PATTERNS = Object.freeze({
  ...OVERRIDE_TRAIN_PATTERNS,
  "split-relay": "0012220011",
  "delayed-loop": "0001122210",
  "staggered-return": "0001102200",
  "second-return": "0110001220",
  "friday-detour": "0011200112",
  "relay-backtrack": "0011122110",
});

export const OVERRIDE_FAMILIES = Object.freeze({
  validation: Object.freeze(["split-relay", "delayed-loop"]),
  test: Object.freeze(["staggered-return", "second-return", "friday-detour", "relay-backtrack"]),
  archive: Object.freeze(["double-return"]),
});
