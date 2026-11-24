import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, makeScenario, observe} from '../../../docs/lib/world.js';
import {distribution, initAdapter, project, randomStream} from '../adapter.mjs';
import {toolMenu} from '../menu.mjs';
import {counterfactuals, improve, policyGradient, protocol} from './credit.mjs';
import {episode} from './episode.mjs';

const input = {hidden:[0.47,-1.23,0.81],logits:[1.7,1.1,-0.6,0.83,0.1,1.3,0.6,1.5],
  slots:[0,2,7],returns:[0.37,1.33,0.99]};
function independentObjective(adapter, record) {
  const p=protocol;
  const pi=distribution(record.logits,project(adapter,record.hidden),adapter,record.slots,p.behaviorTemperature);
  const base=distribution(record.logits,Array(4).fill(0),adapter,record.slots,p.behaviorTemperature);
  const values=record.returns.map(q=>Math.exp(q/p.targetTemperature));
  const sum=values.reduce((a,b)=>a+b,0);
  const weight=Math.min(1,(Math.max(...record.returns)-Math.min(...record.returns))/p.fullWeightSpread);
  return weight * pi.reduce((s,v,i)=>s+Math.log(v)*((1-p.baseAnchor)*values[i]/sum+p.baseAnchor*base[i]),0);
}

test('the counterfactual target gives the correct analytical derivatives for both rank-four factors',()=>{
  const rng=randomStream(117);
  const adapter=initAdapter(3,rng);
  adapter.output=adapter.output.map(()=>0.1+0.2*rng());
  const grad=policyGradient(adapter,input);
  for (const key of ['input','output']) {
    for (let i=0;i<adapter[key].length;i++) {
      const original=adapter[key][i];
      adapter[key][i]=original+1e-5;
      const high=independentObjective(adapter,input);
      adapter[key][i]=original-1e-5;
      const low=independentObjective(adapter,input);
      adapter[key][i]=original;
      assert.ok(Math.abs((high-low)/2e-5-grad[key][i])<3e-8,key+'/'+i);
    }
  }
  const before=independentObjective(adapter,input);
  improve(adapter,[input],{steps:0});
  assert.ok(independentObjective(adapter,input)>before);
});

test('uninformative branches make no parameter or optimizer change',()=>{
  const adapter=initAdapter(3,randomStream(19));
  const old=structuredClone(adapter), optimizer={steps:0};
  const update=improve(adapter,[{...input,returns:[0.7,0.7,0.7]}],optimizer);
  assert.equal(update.updated,false);
  assert.deepEqual(optimizer,{steps:0});
  assert.deepEqual(adapter,old);
});

test('all offered calls use independent terminal simulator branches',()=>{
  const world=createWorld(makeScenario(98712345,'demand-surge'));
  const before=structuredClone(world);
  const menu=toolMenu(observe(world));
  const first=counterfactuals(world,menu);
  assert.deepEqual(world,before);
  assert.deepEqual(first,counterfactuals(world,menu));
  assert.equal(first.returns.length,menu.size);
  assert.ok(first.returns.every(Number.isFinite));
  assert.ok(first.toolCalls>=menu.size);
});

test('a synthetic encoder exercises the full update and branch-free inference paths',async()=>{
  const state={adapter:null,optimizer:{steps:0}};
  const encode=async()=>({h:Float32Array.from(input.hidden),logits:input.logits});
  const options={seed:9783451,family:'capacity-cut',encode,state};
  const train=await episode({...options,mode:'collect',random:randomStream(555)});
  assert.equal(train.actions.length,train.metrics.toolCalls);
  assert.ok(train.updates.some(u=>u.updated));
  assert.ok(train.credits.every(c=>c.slots.length===c.returns.length));
  const saved=structuredClone(state);
  for(const mode of ['base','trained','dispatcher']) {
    const replay=await episode({...options,mode,capture:true});
    assert.equal(replay.actions.length,replay.metrics.toolCalls);
    assert.equal(replay.trace.length,replay.actions.length);
    assert.equal(replay.branchCount,0);
    assert.deepEqual(replay.updates,[]);
    assert.deepEqual(state,saved);
  }
});
