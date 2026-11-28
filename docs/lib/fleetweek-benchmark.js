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

function matchesConfig(suite, record, config) {
  return record && (suite.configKeys ?? ["family","seed"]).every(key=>matches(record[key],config[key]));
}

function checkedBank(suite, bank, split, manifest) {
  if (!bank || bank.suite !== suite.id || bank.split !== split || bank.cases?.length !== manifest.length) {
    throw new Error("The reference bank does not match this fleet split.");
  }
  for (const [i, config] of manifest.entries()) {
    if (!matchesConfig(suite,bank.cases[i],config)) throw new Error("Reference manifest mismatch.");
  }
  return bank.cases;
}

export function replayFleetActions(config, actions, createWeek = createFleetWeek) {
  if (!Array.isArray(actions) || actions.length !== 10 || actions.some(id => typeof id !== "string")) {
    throw new Error("A five-day week needs ten joint dispatch decisions.");
  }
  const week = createWeek(config);
  for (const id of actions) week.step(id);
  if (!week.done) throw new Error("Incomplete week.");
  return fleetLedger(week.ledger);
}

function buildReport(suite, split, policy, cases, reference) {
  if (typeof policy !== "string" || !policy.trim() || policy.length > 120) throw new Error("Use an agent name of 1–120 characters.");
  const rows = cases.map((row, i) => ({family: row.family, agent: row.ledger, ...suite.rowMetadata?.(reference[i], row),
    ...Object.fromEntries(suite.references.map(name => [name, reference[i][suite.referenceFields?.[name] ?? name].ledger]))}));
  return {suite: suite.id, version: 1, split, policy, cases, summary: suite.summarize(rows)};
}

export async function benchmarkFleetSuite(suite, {split = "test", policy = "agent", createPolicy, bank}) {
  const manifest = suite.cases(split);
  const reference = checkedBank(suite, bank, split, manifest);
  const cases = [];
  for (const config of manifest) {
    const decide = await createPolicy();
    const week = (suite.createWeek ?? createFleetWeek)(config);
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
  return buildReport(suite, split, policy, cases, reference);
}

export function verifyFleetSuite(suite, report, bank) {
  if (report?.suite !== suite.id || report.version !== 1) throw new Error("Unrecognized fleet report.");
  const manifest = suite.cases(report.split);
  const reference = checkedBank(suite, bank, report.split, manifest);
  if (!Array.isArray(report.cases) || report.cases.length !== manifest.length) throw new Error("Wrong number of weeks.");
  for (const [i, config] of manifest.entries()) {
    const row = report.cases[i];
    if (!matchesConfig(suite,row,config)) throw new Error("A week differs from the fixed manifest.");
    const ledger = replayFleetActions(config, row.actions, suite.createWeek);
    if (!matches(ledger, row.ledger)) throw new Error("The submitted ledger differs from the replay.");
  }
  const verified = buildReport(suite, report.split, report.policy, report.cases, reference);
  if (!matches(report.summary, verified.summary)) throw new Error("The submitted comparison differs from the verified scores.");
  return verified;
}

const fleetSuite = {id: FLEET_SUITE, cases: fleetCases, summarize: summarizeFleet, references: ["rl","planner","greedy"]};
export const benchmarkFleetWeek = options => benchmarkFleetSuite(fleetSuite, options);
export const verifyFleetReport = (report, weights, bank) => verifyFleetSuite(fleetSuite, report, bank);
