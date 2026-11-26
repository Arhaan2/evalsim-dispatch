import { FLEET_FAMILIES } from "./fleetweek.js";

export const FLEET_SUITE = "dispatch-fleetweek-v1";
export const FLEET_SPLITS = ["validation", "test"];
export const FIT_SEEDS = [13, 37, 73, 101, 211];
export const DECISION_MS = 1000;
export const SERVICE_TARGET = 70;
export const SERVICE_MARGIN = 1;
const SAMPLES = 2000;
const BOOTSTRAP_SEED = 9713;

export function fleetCases(split) {
  if (!FLEET_SPLITS.includes(split)) throw new Error("Unknown fleet evaluation split.");
  const count = split === "test" ? 512 : 128;
  const start = split === "test" ? 86000000 : 82000000;
  return FLEET_FAMILIES[split].flatMap((family, i) =>
    Array.from({length: count}, (_, n) => ({family, seed: start + i * 10000 + n})));
}

export function fleetLedger(ledger) {
  const fields = ["net", "gross", "loadedCost", "emptyCost", "penalty", "served", "contracts", "emptyMiles"];
  for (const key of fields) {
    if (!Number.isSafeInteger(ledger[key])) throw new Error("Invalid fleet ledger field " + key);
  }
  if (ledger.contracts !== 10 || ledger.served < 0 || ledger.served > 10 ||
      ledger.net !== ledger.gross - ledger.loadedCost - ledger.emptyCost - ledger.penalty) {
    throw new Error("Unbalanced fleet ledger or incomplete week.");
  }
  return Object.fromEntries(fields.map(key => [key, ledger[key]]));
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function bounds(sorted) {
  sorted.sort((a, b) => a - b);
  return [sorted[Math.floor(.025 * (SAMPLES - 1))], sorted[Math.ceil(.975 * (SAMPLES - 1))]];
}

// Weeks are independent within each schedule. Keep its share of the sample fixed.
export function pairedFleetComparison(rows, other) {
  const strata = new Map();
  let wins = 0, ties = 0;
  const net = [], service = [];
  for (const row of rows) {
    const delta = row.agent.net - row[other].net;
    const onTime = 10 * (row.agent.served - row[other].served);
    wins += Number(delta > 0);
    ties += Number(delta === 0);
    net.push(delta);
    service.push(onTime);
    if (!strata.has(row.family)) strata.set(row.family, []);
    strata.get(row.family).push(net.length - 1);
  }
  let rng = BOOTSTRAP_SEED;
  const netSamples = [], serviceSamples = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    let profitSum = 0, serviceSum = 0;
    for (const indices of strata.values()) {
      for (let j = 0; j < indices.length; j++) {
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        const k = indices[Math.floor(rng / 4294967296 * indices.length)];
        profitSum += net[k];
        serviceSum += service[k];
      }
    }
    netSamples.push(profitSum / rows.length);
    serviceSamples.push(serviceSum / rows.length);
  }
  return {net: mean(net), net95: bounds(netSamples), servicePP: mean(service), service95: bounds(serviceSamples),
    wins, ties, losses: rows.length - wins - ties};
}

export function fleetAverages(rows, key) {
  const ledgers = rows.map(row => row[key]);
  const totals = {};
  for (const field of Object.keys(ledgers[0])) totals[field] = mean(ledgers.map(l => l[field]));
  return {...totals, onTime: 10 * totals.served, targetWeeks: ledgers.filter(l => 10 * l.served >= SERVICE_TARGET).length};
}

export function summarizeFleet(rows) {
  if (!rows.length) throw new Error("No weeks to summarize.");
  const section = group => {
    const policies = Object.fromEntries(["agent","rl","planner","greedy"].map(key => [key, fleetAverages(group, key)]));
    const comparisons = Object.fromEntries(["rl","planner","greedy"].map(key => [key, pairedFleetComparison(group, key)]));
    const primary = comparisons.planner;
    const beatsPlanner = primary.net95[0] > 0 && primary.service95[0] >= -SERVICE_MARGIN &&
      policies.agent.onTime >= SERVICE_TARGET && policies.planner.onTime >= SERVICE_TARGET;
    return {weeks: group.length, policies, comparisons, beatsPlanner};
  };
  const families = [...new Set(rows.map(row => row.family))];
  return {all: section(rows), byFamily: Object.fromEntries(families.map(f => [f, section(rows.filter(r => r.family === f))]))};
}

export function summarizeFleetGroup(rows, referenceKeys) {
  const policies = Object.fromEntries(["agent", ...referenceKeys].map(key => [key, fleetAverages(rows, key)]));
  const comparisons = Object.fromEntries(referenceKeys.map(key => [key, pairedFleetComparison(rows, key)]));
  const {net95, servicePP, service95} = comparisons.planner;
  const earnsMoreThanPlanner = net95[0] > 0;
  const matchesPlannerService = servicePP >= 0 && service95[0] >= 0;
  return {weeks: rows.length, policies, comparisons, earnsMoreThanPlanner, matchesPlannerService,
    beatsPlanner: earnsMoreThanPlanner && matchesPlannerService};
}

export function summarizeFleetReferences(rows, referenceKeys) {
  if (!rows.length) throw new RangeError("No weeks to summarize.");
  const groups = Map.groupBy(rows, row => row.family);
  return {all: summarizeFleetGroup(rows, referenceKeys), byFamily: Object.fromEntries(
    Array.from(groups, ([family, block]) => [family, summarizeFleetGroup(block, referenceKeys)]))};
}
