// The simulator permutes the three symbolic depots for each freight week.
export const UNCERTAINTY_PATTERNS = Object.freeze({
  "short-week-loop": "0012222001",
  "midweek-relay": "0001122111",
  "switchback-home": "0011000220",
  "late-double-loop": "0001002110",
  "closing-relay": "0011222012",
  "midweek-feint": "0001011222",
});

export const UNCERTAINTY_FAMILIES = Object.freeze({
  validation: Object.freeze(["short-week-loop", "midweek-relay"]),
  test: Object.freeze(["switchback-home", "late-double-loop", "closing-relay", "midweek-feint"]),
  archive: Object.freeze(["double-return"]),
});
