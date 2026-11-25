import { createFleetWeek } from "./fleetweek.js";
import { chooseFleetPlanner, chooseFleetGreedy } from "./fleetweek-planner.js";
import { makeFleetPolicy } from "./fleetweek-policy.js";
import { FLEET_SUITE, DECISION_MS, fleetCases, fleetLedger, summarizeFleet } from "./fleetweek-study.js";

export { createFleetWeek, runFleetWeek, FLEET_DEPOTS, FLEET_FAMILIES } from "./fleetweek.js";
export { fleetCases, FLEET_SUITE } from "./fleetweek-study.js";
export function fleetReferences(weights) {
  return {rl: makeFleetPolicy(weights), planner: chooseFleetPlanner, greedy: chooseFleetGreedy};
}

function matches(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && matches(a[k], b[k]));
}

function checkedBank(bank, split, manifest) {
  if (!bank || bank.suite !== FLEET_SUITE || bank.split !== split || bank.cases?.length !== manifest.length) {
    throw new Error("The reference bank does not match this fleet split.");
  }
  for (const [i, config] of manifest.entries()) {
    if (bank.cases[i].family !== config.family || bank.cases[i].seed !== config.seed) throw new Error("Reference manifest mismatch.");
  }
  return bank.cases;
}

export function replayFleetActions(config, actions) {
  if (!Array.isArray(actions) || actions.length !== 10 || actions.some(id => typeof id !== "string")) {
    throw new Error("A five-day week needs ten joint dispatch decisions.");
  }
  const week = createFleetWeek(config);
  for (const id of actions) week.step(id);
  if (!week.done) throw new Error("Incomplete week.");
  return fleetLedger(week.ledger);
}

function buildReport(split, policy, cases, reference) {
  if (typeof policy !== "string" || !policy.trim() || policy.length > 120) throw new Error("Use an agent name of 1–120 characters.");
  const rows = cases.map((row, i) => ({family: row.family, agent: row.ledger, rl: reference[i].rl.ledger,
    greedy: reference[i].greedy.ledger, planner: reference[i].planner.ledger}));
  return {suite: FLEET_SUITE, version: 1, split, policy, cases, summary: summarizeFleet(rows)};
}

export async function benchmarkFleetWeek({split = "test", policy = "agent", createPolicy, bank}) {
  const manifest = fleetCases(split);
  const reference = checkedBank(bank, split, manifest);
  const cases = [];
  for (const config of manifest) {
    const decide = await createPolicy();
    const week = createFleetWeek(config);
    const actions = [];
    while (!week.done) {
      const obs = week.observe(), legal = week.legalActions();
      const start = performance.now();
      const id = await decide(obs, legal);
      if (performance.now() - start > DECISION_MS) throw new Error("Fleet decision exceeded the one-second budget.");
      week.step(id);
      actions.push(id);
    }
    cases.push({...config, actions, ledger: fleetLedger(week.ledger)});
  }
  return buildReport(split, policy, cases, reference);
}

export function verifyFleetReport(report, weights, bank) {
  if (report?.suite !== FLEET_SUITE || report.version !== 1) throw new Error("Unrecognized fleet report.");
  const manifest = fleetCases(report.split);
  const reference = checkedBank(bank, report.split, manifest);
  if (!Array.isArray(report.cases) || report.cases.length !== manifest.length) throw new Error("Wrong number of weeks.");
  for (const [i, config] of manifest.entries()) {
    const row = report.cases[i];
    if (row?.family !== config.family || row.seed !== config.seed) throw new Error("A week differs from the fixed manifest.");
    const ledger = replayFleetActions(config, row.actions);
    if (!matches(ledger, row.ledger)) throw new Error("The submitted ledger differs from the replay.");
  }
  const verified = buildReport(report.split, report.policy, report.cases, reference);
  if (!matches(report.summary, verified.summary)) throw new Error("The submitted comparison differs from the verified scores.");
  return verified;
}
