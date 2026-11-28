// Freight tapes are relative. Each week independently permutes their depot labels.
export const ADDGUARD_PATTERNS = Object.freeze({
  "guard-crossing":"0011210221", "guard-pivot":"0001220102",
  "guard-return":"0011202101", "guard-ramp":"0100122211",
  "guard-departure":"0010021221", "guard-loop":"0120021120",
  "guard-handoff":"0012110200", "guard-relay":"0112201022",
  "guard-split":"0011220102", "guard-turn":"0100221210",
});
