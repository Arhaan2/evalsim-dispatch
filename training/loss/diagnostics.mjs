import assert from "node:assert/strict";
import {createFleetWeek} from "../../docs/lib/fleetweek.js";
import {fleetLedger} from "../../docs/lib/fleetweek-study.js";
import {isOvernight, sameFreight} from "../../docs/lib/overnight-policy.js";
import {inspectLoss} from "../../docs/lib/loss-policy.js";
import {forkFleetWeek} from "../fleetweek/score-helpers.mjs";

const forecasts = ["lossProbability", "usedProbability", "rawProbability", "lossSize",
  "nonLossGain", "expectedNet", "serviceGain", "score", "flatScore"];

export function lossBranches(config, record, model, weights, refs) {
  const week = createFleetWeek(config);
  const branches = [];
  for (const [epoch, chosen] of record.actions.entries()) {
    if (isOvernight(epoch)) {
      const obs = week.observe(), menu = week.legalActions();
      const detail = inspectLoss(obs, menu, model, weights.override, weights.uncertainty);
      const {plannerId, proposalId} = detail;
      assert.equal(plannerId, refs.planner(obs, menu));
      assert.equal(proposalId ?? plannerId, refs.override(obs, menu), "Only actual predecessor proposals");
      assert.equal(detail.chosenId, chosen);
      if (proposalId != null) {
        assert.notEqual(plannerId, proposalId);
        assert([plannerId, proposalId].includes(chosen));
        assert(sameFreight(menu.find(a => a.id === plannerId), menu.find(a => a.id === proposalId)));
        const estimates = Object.fromEntries(forecasts.map(k => [k, detail[k]]));
        assert(forecasts.every(k => Number.isFinite(estimates[k])));
        assert.equal(estimates.lossProbability, estimates.usedProbability);
        estimates.constantLossId = refs.constantLoss(obs, menu);
        estimates.flatRiskId = refs.flatRisk(obs, menu);
        const prefix = record.actions.slice(0, epoch);
        const alternate = chosen === proposalId ? plannerId : proposalId;
        const releaseFork = forkFleetWeek(config, prefix, alternate, refs.rl);
        // Conditional loss labels use the same successor dispatcher as the training target.
        // Release decisions above use their own successor dispatcher through Friday.
        const targetPlan = forkFleetWeek(config, prefix, plannerId, refs.flatRisk);
        const targetProposal = forkFleetWeek(config, prefix, proposalId, refs.flatRisk);
        branches.push([epoch, plannerId, proposalId, ...releaseFork, targetProposal[1] - targetPlan[1], estimates]);
      }
    }
    week.step(chosen);
  }
  return branches;
}

// Midranks give half credit for tied probabilities in positive/negative pairs.
function rankAuc(samples, losses) {
  if (losses === 0 || losses === samples.length) return null;
  const ranked = [...samples].sort((a, b) => a.probability - b.probability);
  let positiveRankSum = 0;
  for (let i = 0; i < ranked.length;) {
    let end = i, positives = 0;
    while (end < ranked.length && ranked[end].probability === ranked[i].probability) {
      positives += Number(ranked[end++].difference < 0);
    }
    positiveRankSum += positives * (i + 1 + end) / 2;
    i = end;
  }
  return (positiveRankSum - losses * (losses + 1) / 2) / (losses * (samples.length - losses));
}

export function classifyProposals(samples, constantProbability) {
  const bins = Array.from({length: 5}, (_, i) => ({lower: i / 5, upper: (i + 1) / 5, n: 0, losses: 0, total: 0}));
  let losses = 0, ties = 0, predicted = 0, brier = 0, constantBrier = 0;
  assert(constantProbability >= 0 && constantProbability <= 1);
  for (const {probability, difference} of samples) {
    assert(Number.isFinite(probability) && probability >= 0 && probability <= 1);
    assert(Number.isFinite(difference));
    const loss = Number(difference < 0);
    losses += loss;
    ties += Number(difference === 0);
    predicted += probability;
    brier += (probability - loss) ** 2;
    constantBrier += (constantProbability - loss) ** 2;
    const bin = bins[Math.min(4, Math.floor(probability * 5))];
    bin.n++;
    bin.losses += loss;
    bin.total += probability;
  }
  const n = samples.length;
  return {n, losses, ties, prevalence: n ? losses / n : null, meanPredicted: n ? predicted / n : null,
    brier: n ? brier / n : null, constantBrier: n ? constantBrier / n : null, constantProbability,
    auc: rankAuc(samples, losses), bins: bins.map(({total, ...bin}) => ({...bin,
      meanPredicted: bin.n ? total / bin.n : null, lossRate: bin.n ? bin.losses / bin.n : null}))};
}

const tally = () => ({nights: 0, helped: 0, tied: 0, hurt: 0, netGain: 0, serviceGain: 0});

function workedExample({row, branch, choice, netGain, serviceGain}) {
  const [epoch, plannerId, proposalId, suffix, net, served, targetNetDifference, estimates] = branch;
  const prefix = row.rl.actions.slice(0, epoch), actions = [...prefix, ...suffix];
  const week = createFleetWeek(row);
  for (const id of actions) week.step(id);
  const ledger = fleetLedger(week.ledger);
  assert.equal(ledger.net, net);
  assert.equal(ledger.served, served);
  return {family: row.family, seed: row.seed, epoch, choice, plannerId, proposalId, estimates,
    chosenId: row.rl.actions[epoch], alternativeId: suffix[0], prefix, chosen: row.rl,
    alternative: {actions, ledger}, netGain, serviceGain, targetNetDifference};
}

export function summarizeLossDecisions(cases, model) {
  const report = {nights: 4 * cases.length, eligible: 0, accept: tally(), decline: tally(),
    constantLossChanges: 0, flatRiskChanges: 0, examples: []};
  const samples = [], examples = new Map();
  for (const row of cases) for (const branch of row.branches) {
    const [epoch, plannerId, , , alternateNet, alternateServed, difference, estimates] = branch;
    const chosen = row.rl.actions[epoch];
    const choice = chosen === plannerId ? "decline" : "accept";
    const netGain = row.rl.ledger.net - alternateNet, serviceGain = row.rl.ledger.served - alternateServed;
    const group = report[choice];
    report.eligible++;
    report.constantLossChanges += Number(chosen !== estimates.constantLossId);
    report.flatRiskChanges += Number(chosen !== estimates.flatRiskId);
    group.nights++;
    group[netGain > 0 ? "helped" : netGain < 0 ? "hurt" : "tied"]++;
    group.netGain += netGain;
    group.serviceGain += serviceGain;
    samples.push({probability: estimates.lossProbability, difference});
    if (netGain !== 0) {
      const key = choice + "/" + Math.sign(netGain);
      if (!examples.has(key)) examples.set(key, []);
      examples.get(key).push({row, branch, choice, netGain, serviceGain});
    }
  }
  report.classifier = classifyProposals(samples, model.globalLossRate);
  for (const key of ["accept/1", "accept/-1", "decline/1", "decline/-1"]) {
    const group = examples.get(key);
    if (!group) continue;
    const amounts = group.map(item => item.netGain).sort((a, b) => a - b);
    const median = (amounts[Math.floor((amounts.length - 1) / 2)] + amounts[Math.floor(amounts.length / 2)]) / 2;
    const example = group.reduce((best, item) =>
      Math.abs(item.netGain - median) < Math.abs(best.netGain - median) ? item : best);
    report.examples.push(workedExample(example));
  }
  return report;
}
