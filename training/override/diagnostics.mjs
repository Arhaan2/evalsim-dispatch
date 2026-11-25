import {forkFleetWeek} from "../fleetweek/score-helpers.mjs";
import {createFleetWeek} from "../../docs/lib/fleetweek.js";
import {fleetLedger} from "../../docs/lib/fleetweek-study.js";
import {inspectOverride, makeOverridePolicy} from "../../docs/lib/override-policy.js";
import {isOvernight, sameFreight} from "../../docs/lib/overnight-policy.js";

export function overrideBranches(config, path, checkpoint) {
  const state = createFleetWeek(config);
  const decide = makeOverridePolicy(checkpoint);
  const branches = [];
  for (const [epoch, chosen] of path.actions.entries()) {
    if (isOvernight(epoch)) {
      const menu = state.legalActions();
      const {plannerId, proposalId, chosenId} = inspectOverride(state.observe(), menu, checkpoint);
      if (chosen !== chosenId) throw Error("Gate diagnosis differs from its deployed action.");
      if (proposalId != null) {
        const planner = menu.find(a => a.id === plannerId);
        const proposal = menu.find(a => a.id === proposalId);
        if (proposalId === plannerId || !sameFreight(planner, proposal) || ![plannerId, proposalId].includes(chosen)) {
          throw Error("A challenger must preserve the planner's signed assignments and change its empty placement.");
        }
        const opposite = chosen === plannerId ? proposalId : plannerId;
        branches.push([epoch, plannerId, proposalId, ...forkFleetWeek(config, path.actions.slice(0, epoch), opposite, decide)]);
      }
    }
    state.step(chosen);
  }
  return branches;
}

function counts() {
  return {nights: 0, helped: 0, tied: 0, hurt: 0, netGain: 0, serviceGain: 0};
}

function workedExample({row, branch, choice, netGain, serviceGain}, checkpoint) {
  const [epoch, plannerId, proposalId, suffix] = branch;
  const prefix = row.rl.actions.slice(0, epoch);
  const fork = createFleetWeek(row);
  for (const id of prefix) fork.step(id);
  const detail = inspectOverride(fork.observe(), fork.legalActions(), checkpoint);
  const estimates = Object.fromEntries(["netGain", "serviceGain", "score", "threshold"].map(k => [k, detail[k]]));
  for (const id of suffix) fork.step(id);
  return {family: row.family, seed: row.seed, epoch, choice, plannerId, proposalId, estimates,
    chosenId: row.rl.actions[epoch], alternativeId: suffix[0], prefix, chosen: row.rl,
    alternative: {actions: [...prefix, ...suffix], ledger: fleetLedger(fork.ledger)}, netGain, serviceGain};
}

export function summarizeOverrides(cases, checkpoint) {
  const report = {nights: 4 * cases.length, eligible: 0, accept: counts(), decline: counts(), examples: []};
  const buckets = new Map();
  for (const row of cases) {
    for (const branch of row.branches) {
      const [epoch, plannerId, , , net, served] = branch;
      const choice = row.rl.actions[epoch] === plannerId ? "decline" : "accept";
      const netGain = row.rl.ledger.net - net;
      const serviceGain = row.rl.ledger.served - served;
      const group = report[choice];
      report.eligible++;
      group.nights++;
      group[netGain > 0 ? "helped" : netGain < 0 ? "hurt" : "tied"]++;
      group.netGain += netGain;
      group.serviceGain += serviceGain;
      if (netGain) {
        const key = choice + "/" + Math.sign(netGain);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({row, branch, choice, netGain, serviceGain});
      }
    }
  }
  for (const key of ["accept/1", "accept/-1", "decline/1", "decline/-1"]) {
    const group = buckets.get(key);
    if (!group) continue;
    const sorted = group.map(item => item.netGain).sort((a, b) => a - b);
    const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
    // Manifest order, then epoch, provides the deterministic tie break.
    const representative = group.reduce((best, item) =>
      Math.abs(item.netGain - median) < Math.abs(best.netGain - median) ? item : best);
    report.examples.push(workedExample(representative, checkpoint));
  }
  return report;
}
