import {createFleetWeek} from "../../docs/lib/fleetweek.js";
import {fleetLedger} from "../../docs/lib/fleetweek-study.js";
import {isOvernight, sameFreight} from "../../docs/lib/overnight-policy.js";
import {makeOverridePolicy} from "../../docs/lib/override-policy.js";
import {inspectUncertainty, makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {forkFleetWeek} from "../fleetweek/score-helpers.mjs";

const estimateKeys = ["priorNetGain", "riskMean", "netGain", "serviceGain", "downside", "penalty", "score", "riskVeto"];

export function uncertaintyBranches(config, released, model, priorModel) {
  const state = createFleetWeek(config);
  const decide = makeUncertaintyPolicy(model, priorModel);
  const prior = makeOverridePolicy(priorModel);
  const meanOnly = makeUncertaintyPolicy(model, priorModel, {meanOnly:true});
  const flatRisk = makeUncertaintyPolicy(model, priorModel, {flatRisk:true});
  const branches = [];
  for (const [epoch,chosen] of released.actions.entries()) {
    if (isOvernight(epoch)) {
      const obs = state.observe(), menu = state.legalActions();
      const detail = inspectUncertainty(obs, menu, model, priorModel);
      const {plannerId, proposalId, chosenId} = detail;
      const predecessorId = prior(obs,menu);
      if (chosen !== chosenId || (proposalId ?? plannerId) !== predecessorId) {
        throw Error("The gate must decide on the predecessor's actual choice.");
      }
      if (proposalId != null) {
        const proposal = menu.find(a => a.id === proposalId), planner = menu.find(a => a.id === plannerId);
        if (proposalId === plannerId || !sameFreight(planner, proposal) || ![plannerId,proposalId].includes(chosen)) {
          throw Error("Deferral must preserve signed work and keep one of the two proposed placements.");
        }
        const estimates = Object.fromEntries(estimateKeys.map(key => [key,detail[key]]));
        estimates.meanOnlyId = meanOnly(obs,menu);
        estimates.flatRiskId = flatRisk(obs,menu);
        for (const key of estimateKeys.slice(0,-1)) if (!Number.isFinite(estimates[key])) throw Error("Missing forecast " + key);
        if (estimates.riskVeto !== (chosen !== estimates.meanOnlyId)) throw Error("Incorrect downside-veto flag.");
        const prefix = released.actions.slice(0,epoch);
        const alternate = chosen === plannerId ? proposalId : plannerId;
        const releaseFork = forkFleetWeek(config, prefix, alternate, decide);
        // The downside estimator was calibrated under frozen predecessor continuation.
        // Reproduce that target separately from the two deployed-policy Friday outcomes.
        const priorPlan = forkFleetWeek(config, prefix, plannerId, prior);
        const priorProposal = forkFleetWeek(config, prefix, proposalId, prior);
        branches.push([epoch, plannerId, proposalId, ...releaseFork, priorProposal[1] - priorPlan[1], estimates]);
      }
    }
    state.step(chosen);
  }
  return branches;
}

function tally() {
  return {nights:0, helped:0, tied:0, hurt:0, netGain:0, serviceGain:0};
}

function workedExample({row,branch,choice,netGain,serviceGain}) {
  const [epoch,plannerId,proposalId,suffix,,,priorContinuationNetDifference,estimates] = branch;
  const prefix = row.rl.actions.slice(0,epoch);
  const actions = [...prefix,...suffix];
  const replay = createFleetWeek(row);
  for (const id of actions) replay.step(id);
  return {family:row.family, seed:row.seed, epoch, choice, plannerId, proposalId, estimates,
    chosenId:row.rl.actions[epoch], alternativeId:suffix[0], prefix, chosen:row.rl,
    alternative:{actions,ledger:fleetLedger(replay.ledger)}, netGain, serviceGain, priorContinuationNetDifference};
}

export function summarizeUncertaintyDecisions(cases, model) {
  const cuts = model.riskCuts;
  const bands = ["low","middle","high"].map(name => ({name,nights:0,accepted:0,deferred:0,
    predictedTotal:0,observedTotal:0,proposalLosses:0}));
  const report = {nights:4*cases.length, eligible:0, accept:tally(), decline:tally(), meanOnlyChanges:0, flatRiskChanges:0,
    riskCuts:cuts, riskBands:[], examples:[]};
  const buckets = new Map();
  for (const row of cases) for (const branch of row.branches) {
    const [epoch,plannerId,, ,oppositeNet,oppositeService,priorDifference,estimates] = branch;
    const selected = row.rl.actions[epoch];
    const accepted = selected !== plannerId;
    const choice = accepted ? "accept" : "decline";
    const netGain = row.rl.ledger.net - oppositeNet, serviceGain = row.rl.ledger.served - oppositeService;
    const group = report[choice];
    report.eligible++;
    report.meanOnlyChanges += Number(selected !== estimates.meanOnlyId);
    report.flatRiskChanges += Number(selected !== estimates.flatRiskId);
    group.nights++;
    group[netGain > 0 ? "helped" : netGain < 0 ? "hurt" : "tied"]++;
    group.netGain += netGain;
    group.serviceGain += serviceGain;
    const band = bands[estimates.downside <= cuts[0] ? 0 : estimates.downside <= cuts[1] ? 1 : 2];
    band.nights++;
    band[accepted ? "accepted" : "deferred"]++;
    band.predictedTotal += estimates.downside;
    band.observedTotal += Math.max(0, estimates.riskMean - priorDifference);
    band.proposalLosses += Number((accepted ? netGain : -netGain) < 0);
    if (netGain) {
      const key = choice + "/" + Math.sign(netGain);
      if (!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push({row,branch,choice,netGain,serviceGain});
    }
  }
  report.riskBands = bands.map(({predictedTotal,observedTotal,...band})=>({...band,
    meanPredictedDownside:band.nights ? predictedTotal/band.nights : null,
    meanObservedDownside:band.nights ? observedTotal/band.nights : null,
    lossRate:band.nights ? band.proposalLosses/band.nights : null}));
  for (const key of ["accept/1","accept/-1","decline/1","decline/-1"]) {
    const group = buckets.get(key);
    if (!group) continue;
    const sorted = group.map(item=>item.netGain).sort((a,b)=>a-b);
    const median = (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)])/2;
    const representative = group.reduce((best,item)=>
      Math.abs(item.netGain-median) < Math.abs(best.netGain-median) ? item : best);
    report.examples.push(workedExample(representative));
  }
  return report;
}
