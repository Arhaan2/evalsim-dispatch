// New market shapes are separate from the original five-day fleet manifests.
export const OVERNIGHT_PATTERNS = Object.freeze({
  "morning-loop": "0012221100",
  "delayed-homecoming": "0001111200",
  "early-double-return": "0110002200",
  "late-double-return": "0001100020",
  "overnight-relay": "0011222001",
  "late-homecoming": "0111222200",
});

export const OVERNIGHT_FAMILIES = Object.freeze({
  validation: Object.freeze(["morning-loop", "delayed-homecoming"]),
  test: Object.freeze(["early-double-return", "late-double-return", "overnight-relay", "late-homecoming"]),
  archive: Object.freeze(["double-return"]),
});
