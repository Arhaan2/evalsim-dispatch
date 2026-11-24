import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorld,dispatcher,makeScenario,observe,step} from '../../../docs/lib/world.js';
import {toolMenu} from '../menu.mjs';
import {protocol,counterfactuals,metrics} from './credit.mjs';
import {model,sourceHash,summarize} from './provenance.mjs';

const dir=process.argv[2] ? pathToFileURL(resolve(process.argv[2])+'/') : new URL('../../../docs/data/llm-credit/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,dir),'utf8'));
const data=await read('results.json');
const adapter=await read('adapter.json');
assert.deepEqual(data.protocol,protocol);
assert.equal(data.signature,await sourceHash());
assert.equal(adapter.sourceSha256,data.signature);
assert.equal(data.modelSha256,model.sha256);
assert.equal(adapter.modelSha256,data.modelSha256);
assert.equal(adapter.rank,protocol.rank);
assert.equal(adapter.input.length,adapter.rank*adapter.size);
assert.equal(adapter.output.length,adapter.rank*8);
assert.ok(adapter.input.every(Number.isFinite) && adapter.output.every(Number.isFinite));
assert.equal(data.adapterSha256,createHash('sha256').update(await readFile(new URL('adapter.json',dir))).digest('hex'));

function replay(seed,family,actions,check) {
  const world=createWorld(makeScenario(seed,family));
  for (const [i,action] of actions.entries()) {
    assert.equal(world.done,false,'Actions after termination');
    check?.(world,action,i);
    step(world,action);
  }
  return metrics(world);
}
let branches=0,branchCalls=0,trainCalls=0,updates=0;
assert.equal(data.training.length,protocol.trainEpisodes);
for (const [i,row] of data.training.entries()) {
  assert.equal(row.episode,i+1);
  assert.equal(row.seed,protocol.trainSeedStart+i);
  assert.equal(row.family,protocol.trainFamilies[i%protocol.trainFamilies.length]);
  let c=0, episodeBranches=0, episodeBranchCalls=0;
  const m=replay(row.seed,row.family,row.actions,(world,action,d)=>{
    const menu=toolMenu(observe(world));
    assert.ok([...menu.values()].some(a=>JSON.stringify(a)===JSON.stringify(action)));
    if (menu.size===1) return;
    const credit=row.credits[c++];
    assert.equal(credit.decision,d);
    assert.deepEqual(credit.slots,[...menu.keys()]);
    const actual=counterfactuals(world,menu);
    assert.deepEqual(credit.returns,actual.returns);
    assert.equal(credit.toolCalls,actual.toolCalls);
    episodeBranches+=menu.size;
    episodeBranchCalls+=actual.toolCalls;
  });
  assert.deepEqual(m,row.metrics);
  assert.equal(c,row.credits.length);
  assert.equal(row.branches,episodeBranches);
  assert.equal(row.counterfactualToolCalls,episodeBranchCalls);
  assert.equal(row.updates.reduce((s,u)=>s+u.decisions,0),c);
  updates+=row.updates.filter(u=>u.updated).length;
  branches+=episodeBranches; branchCalls+=episodeBranchCalls; trainCalls+=m.toolCalls;
}
assert.equal(data.compute.counterfactualBranches,branches);
assert.equal(data.compute.counterfactualToolCalls,branchCalls);
assert.equal(data.compute.trainingToolCalls,trainCalls);
assert.equal(data.compute.optimizerSteps,updates);
assert.deepEqual(data.validation.map(v=>v.episode),protocol.validationEpisodes);
for(const point of data.validation) {
  const rows=point.cases.map((row,i)=>{
    assert.equal(row.seed,protocol.validationSeedStart+i);
    assert.equal(row.family,protocol.trainFamilies[i%protocol.trainFamilies.length]);
    const {seed,family,actions,...outcome}=row;
    assert.deepEqual(replay(seed,family,actions),outcome);
    return outcome;
  });
  const {episode,cases,trainingCalls,counterfactualCalls,...summary}=point;
  assert.equal(cases.length,protocol.validationSeedsPerFamily*protocol.trainFamilies.length);
  assert.deepEqual(summarize(rows),summary);
  assert.equal(trainingCalls,data.training.slice(0,episode).reduce((s,r)=>s+r.metrics.toolCalls,0));
  assert.equal(counterfactualCalls,data.training.slice(0,episode).reduce((s,r)=>s+r.counterfactualToolCalls,0));
}
const modes=['base','trained','dispatcher'];
assert.equal(data.cases.length,protocol.testSeedsPerFamily*protocol.testFamilies.length);
for(const [i,row] of data.cases.entries()) {
  assert.equal(row.seed,protocol.testSeedStart+i);
  assert.equal(row.family,protocol.testFamilies[i%protocol.testFamilies.length]);
  for(const mode of modes) {
    const observed=replay(row.seed,row.family,row.actions[mode],(world,action,d)=>{
      if(mode==='dispatcher'){assert.deepEqual(action,dispatcher(observe(world)));return;}
      const menu=toolMenu(observe(world)), choice=row.choices[mode][d];
      assert.deepEqual(choice.slots,[...menu.keys()]);
      assert.equal(choice.probabilities.length,menu.size);
      assert.ok(choice.probabilities.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
      assert.ok(Math.abs(choice.probabilities.reduce((a,b)=>a+b,0)-1)<1e-10);
      const best=choice.probabilities.indexOf(Math.max(...choice.probabilities));
      assert.equal(choice.selected,choice.slots[best]);
      assert.deepEqual(action,menu.get(choice.selected));
    });
    assert.deepEqual(observed,row[mode]);
    if(mode!=='dispatcher') assert.equal(row.choices[mode].length,row.actions[mode].length);
  }
}
for(const mode of modes) {
  assert.deepEqual(data.summary[mode],summarize(data.cases.map(row=>row[mode])));
  const trace=await read('trace-'+mode+'.json');
  const row=data.cases.find(r=>r.family==='compound');
  assert.equal(trace.seed,row.seed);
  assert.equal(trace.family,row.family);
  assert.equal(trace.mode,mode);
  assert.deepEqual(trace.trace.map(r=>r.action),row.actions[mode]);
  assert.deepEqual(trace.metrics,row[mode]);
}
console.log('Verified '+data.training.length+' complete training trajectories, '+branches+' counterfactual branches and '+branchCalls+' branch tool calls.');
console.log('Replayed '+data.validation.reduce((s,v)=>s+v.episodes,0)+' validation and '+data.cases.length*modes.length+' held-out episodes; model inference requires the recorded Qwen weights.');
