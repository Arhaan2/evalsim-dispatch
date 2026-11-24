import {distribution, project} from '../adapter.mjs';
import {dispatcher, observe, step, verify} from '../../../docs/lib/world.js';
import {readFile} from 'node:fs/promises';

export const protocol = JSON.parse(await readFile(new URL('protocol.json',import.meta.url),'utf8'));

export function metrics(world) {
  const result = verify(world);
  if (!world.done || result.violations.length) throw new Error('Expected a valid terminal logistics ledger');
  const {success, fulfilled, totalDemand, spend, toolCalls, rejectedActions} = result;
  return {success, fulfilled, totalDemand, spend, toolCalls, rejectedActions};
}

function branchReturn(world) {
  const m = metrics(world);
  return m.fulfilled / m.totalDemand + 0.7 * Number(m.success) -
    0.05 * m.spend / world.scenario.budget - 0.003 * m.toolCalls - 0.008 * m.rejectedActions;
}

export function counterfactuals(world,menu) {
  const returns = [];
  let toolCalls = 0;
  for (const action of menu.values()) {
    const branch = structuredClone(world);
    step(branch, action);
    while (!branch.done) step(branch, dispatcher(observe(branch)));
    returns.push(branchReturn(branch));
    toolCalls += branch.decisions - world.decisions;
  }
  return {returns, toolCalls};
}

function softTargets(returns,p) {
  const high = Math.max(...returns), low = Math.min(...returns);
  const mass = returns.map(value => Math.exp((value - high) / p.targetTemperature));
  const total = mass.reduce((sum,n) => sum+n,0);
  return {target:mass.map(value => value / total), weight:Math.min(1,(high - low) / p.fullWeightSpread)};
}

export function policyGradient(adapter, record, p=protocol) {
  const {hidden, logits, slots, returns} = record;
  const projected = project(adapter,hidden);
  const probs = distribution(logits,projected,adapter,slots,p.behaviorTemperature);
  const base = distribution(logits,Array(adapter.rank).fill(0),adapter,slots,p.behaviorTemperature);
  const {target,weight} = softTargets(returns,p);
  const input = new Float64Array(adapter.input.length), output = new Float64Array(adapter.output.length);
  const dz = Array(adapter.rank).fill(0);
  let objective = 0;
  for (let i=0; i<slots.length; i++) {
    const desired = (1 - p.baseAnchor) * target[i] + p.baseAnchor * base[i];
    objective += weight * desired * Math.log(Math.max(Number.MIN_VALUE,probs[i]));
    const gradient = weight * (desired - probs[i]) / p.behaviorTemperature;
    for (let k=0; k<adapter.rank; k++) {
      const j = slots[i] * adapter.rank + k;
      output[j] += gradient * projected[k];
      dz[k] += gradient * adapter.output[j];
    }
  }
  for (let k=0; k<adapter.rank; k++) {
    const factor = dz[k] / Math.sqrt(adapter.size);
    for (let d=0; d<hidden.length; d++) input[k*adapter.size + d] = factor * hidden[d];
  }
  return {input, output, objective, weight};
}

// The adapter remains fixed while collecting the current decision minibatch.
export function improve(adapter,records,optimizer,p=protocol) {
  if (!records.length) return null;
  const gradient = {input:new Float64Array(adapter.input.length),output:new Float64Array(adapter.output.length)};
  let objective = 0, weight = 0;
  for (const record of records) {
    const g = policyGradient(adapter,record,p);
    weight += g.weight;
    objective += g.objective;
    for (const key of ['input','output']) {
      for (let i=0; i<gradient[key].length; i++) gradient[key][i] += g[key][i] / records.length;
    }
  }
  let squared = 0;
  for (const values of Object.values(gradient)) for (const x of values) squared += x*x;
  const norm = Math.sqrt(squared);
  if (!Number.isFinite(norm) || !Number.isFinite(objective)) throw new Error('Nonfinite decision-credit update');
  // A minibatch with identical counterfactual outcomes provides zero learning signal.
  if (norm === 0) return {decisions:records.length,weight,objective,norm,updated:false};
  const scale = Math.min(1,p.gradientNormCap/norm);
  optimizer.steps++;
  for (const key of ['input','output']) {
    const state = optimizer[key] ??= {m:Array(adapter[key].length).fill(0),v:Array(adapter[key].length).fill(0)};
    const rate = key === 'input' ? p.inputLearningRate : p.outputLearningRate;
    for (let i=0; i<gradient[key].length; i++) {
      const g = gradient[key][i] * scale;
      state.m[i] = 0.9 * state.m[i] + 0.1 * g;
      state.v[i] = 0.999 * state.v[i] + 0.001 * g*g;
      const m = state.m[i] / (1 - 0.9 ** optimizer.steps);
      const v = state.v[i] / (1 - 0.999 ** optimizer.steps);
      adapter[key][i] += rate * m / (Math.sqrt(v)+1e-8);
    }
  }
  return {decisions:records.length,weight,objective,norm,updated:true};
}
