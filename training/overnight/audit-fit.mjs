// Independent checks of the Monte Carlo regression targets and train-only selector.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createFleetWeek, FLEET_FAMILIES, FLEET_PAIRS, fleetPairIndex, fleetWeekActions} from "../../docs/lib/fleetweek.js";
import {bestFleetAction, fleetPlannerContinuation} from "../../docs/lib/fleetweek-planner.js";
import {isOvernight, overnightFeatures, overnightHeads, rankOvernight} from "../../docs/lib/overnight-policy.js";

const directory = new URL("../../docs/data/overnight/", import.meta.url);
const fitSeeds = [13, 37, 73, 101, 211];
const pairs = FLEET_PAIRS.length;
const sum = values => values.reduce((total,value) => total + value, 0);
const mean = values => sum(values) / values.length;

function *weekConfigs(seedStart, perFamily) {
  for (const [index,family] of FLEET_FAMILIES.train.entries()) {
    for (let n=0; n<perFamily; n++) yield {family,seed:seedStart + index*perFamily + n};
  }
}

// The collector drives a greedy truck trajectory. Public boards are exogenous.
// Precompute the original planner's action on each board at all six placements.
function trainingFrames(config) {
  const world = createFleetWeek(config);
  const frames = [];
  while (!world.done) {
    const observation = world.observe();
    const base = fleetPlannerContinuation(observation);
    const transitions = FLEET_PAIRS.map(positions => {
      const menu = fleetWeekActions({...observation,positions});
      const id = bestFleetAction(menu,base);
      return menu.find(action => action.id === id);
    });
    frames.push({observation,base,transitions});
    const bestCurrent = world.legalActions().reduce((best,a) => a.net > best.net ? a : best);
    world.step(bestCurrent.id);
  }
  return frames;
}

// The trainer computes its paired targets backward. Here each truck-pair state
// starts next morning, follows all future planner actions forward, and closes Friday.
function targetsThroughFriday(frames, epoch) {
  const netResiduals = [], served = [];
  for (let arrival=0; arrival<pairs; arrival++) {
    let pair = arrival, net = 0, contracts = 0;
    for (let next=epoch + 1; next<frames.length; next++) {
      const action = frames[next].transitions[pair];
      net += action.net;
      contracts += action.served;
      pair = fleetPairIndex(action.positions);
    }
    netResiduals.push(net - frames[epoch].base[arrival]);
    served.push(contracts);
  }
  const center = vector => {
    const average = mean(vector);
    return vector.map(n => n-average);
  };
  return [...center(netResiduals), ...center(served)];
}

function verifyRegressions(checkpoint) {
  const weekCount = 768 * FLEET_FAMILIES.train.length;
  const gradient = checkpoint.nights.map(() =>
    Array.from({length:2*pairs}, () => new Float64Array(checkpoint.features)));
  let returns = 0;
  for (const config of weekConfigs(checkpoint.trainStart,768)) {
    const frames = trainingFrames(config);
    for (let night=0; night<4; night++) {
      const epoch = 2*night+1;
      const {observation,base} = frames[epoch];
      const x = overnightFeatures(observation,base);
      const targets = targetsThroughFriday(frames,epoch);
      const matrices = checkpoint.nights[night];
      const coefficients = [...matrices.net,...matrices.service];
      for (let output=0; output<targets.length; output++) {
        const prediction = coefficients[output].reduce((total,weight,j) => total + weight*x[j], 0);
        const error = (prediction-targets[output])/weekCount;
        for (let j=0; j<x.length; j++) gradient[night][output][j] += x[j]*error;
      }
      returns += pairs;
    }
  }
  let maxResidual = 0;
  for (const [night,heads] of checkpoint.nights.entries()) {
    for (const [output,coefficients] of [...heads.net,...heads.service].entries()) {
      for (const [j,weight] of coefficients.entries()) {
        const ridgeGradient = j === 0 ? 0 : 0.002*weight;
        const residual = gradient[night][output][j] + ridgeGradient;
        maxResidual = Math.max(maxResidual, Math.abs(residual));
      }
    }
  }
  // Published weights are rounded to eight decimals. The 1e-6 bound is on
  // average gradient per sampled board, including the stated ridge penalty.
  assert(maxResidual < 1e-6, "Stored ridge coefficients fail the normal equations.");
  return {returns,maxResidual};
}

function selectionPaths(config, checkpoint, candidates) {
  const reference = createFleetWeek(config);
  const cached = [];
  while (!reference.done) {
    const obs = reference.observe();
    const base = fleetPlannerContinuation(obs);
    const heads = isOvernight(obs.epoch) ? overnightHeads(obs,base,checkpoint) : null;
    cached.push({base,heads});
    reference.step(bestFleetAction(reference.legalActions(),base));
  }

  // Give each candidate its own simulator. Only position-independent estimates
  // are cached; available actions, rewards and subsequent positions use step().
  return candidates.map(candidate => {
    const world = createFleetWeek(config);
    let overrides = 0;
    while (!world.done) {
      const menu = world.legalActions();
      const {base,heads} = cached[world.observe().epoch];
      const id = bestFleetAction(menu,base);
      const plannerMove = menu.find(a => a.id === id);
      const chosen = heads ? rankOvernight(menu,plannerMove,base,heads,candidate.settings) : id;
      if (chosen !== id) overrides++;
      world.step(chosen);
    }
    return {net:world.ledger.net-reference.ledger.net,
      service:world.ledger.served-reference.ledger.served,overrides};
  });
}

function verifySelection(checkpoint) {
  const candidates = checkpoint.selection.candidates;
  const byCandidate = candidates.map(()=>[]);
  const expectedSettings = [0.45,0.9].flatMap(blend => [0,10,30].flatMap(serviceCredit =>
    [0,1.5].map(minimumGain=>({blend,serviceCredit,minimumGain}))));
  assert.deepEqual(candidates.map(c=>c.settings),expectedSettings);
  for (const config of weekConfigs(checkpoint.selectStart,384)) {
    const paths = selectionPaths(config,checkpoint,candidates);
    paths.forEach((outcome,i) => byCandidate[i].push(outcome));
  }
  for (const [i,scores] of byCandidate.entries()) {
    for (const metric of ["net","service"]) {
      const values = scores.map(row=>row[metric]);
      const estimate = mean(values);
      const squaredDeviations = values.map(v=>(v-estimate)**2);
      const standardError = Math.sqrt(sum(squaredDeviations)/(values.length*(values.length-1)));
      const low = estimate-standardError;
      assert(Math.abs(candidates[i][metric] - estimate) < 1e-7);
      assert(Math.abs(candidates[i][metric+"LowerSE"] - low) < 1e-7);
    }
    assert.equal(candidates[i].changed, sum(scores.map(s=>s.overrides)));
  }
  const feasible = candidates.filter(c=>c.serviceLowerSE >= 0);
  assert.equal(feasible.length,checkpoint.selection.serviceFeasible);
  const winner = feasible.length
    ? [...feasible].sort((a,b)=>b.netLowerSE-a.netLowerSE)[0]
    : [...candidates].sort((a,b)=>b.serviceLowerSE-a.serviceLowerSE || b.netLowerSE-a.netLowerSE)[0];
  assert.deepEqual(winner.settings,checkpoint.settings);
  return sum(byCandidate.map(rows=>rows.length));
}

let targetCount = 0, pathCount = 0, maxResidual = 0;
for (const [index,seed] of fitSeeds.entries()) {
  const checkpoint = JSON.parse(await readFile(new URL("model-"+seed+".json",directory),"utf8"));
  assert.equal(checkpoint.seed,seed);
  assert.equal(checkpoint.trainStart,100000000+index*1000000);
  assert.equal(checkpoint.selectStart,checkpoint.trainStart+200000);
  const fit = verifyRegressions(checkpoint);
  const paths = verifySelection(checkpoint);
  maxResidual = Math.max(maxResidual, fit.maxResidual);
  targetCount += fit.returns;
  pathCount += paths;
  console.log("Verified fit",seed,"max normalized gradient",fit.maxResidual,"and",paths,"selection paths.");
}
console.log("Verified",targetCount,"paired placement returns, 240 regressions and",pathCount,"candidate paths. Largest normalized gradient",maxResidual);
