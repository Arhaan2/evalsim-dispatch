import {createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {cpus,platform,release,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {randomStream} from '../adapter.mjs';
import {openEncoder} from '../worker.mjs';
import {WORLD_VERSION} from '../../../docs/lib/world.js';
import {episode} from './episode.mjs';
import {protocol} from './credit.mjs';
import {model,sourceHash,summarize} from './provenance.mjs';

const [binary,weights,work,destination] = process.argv.slice(2);
if (!binary || !weights || !work || !destination || resolve(work) === resolve(destination)) {
  throw new Error('Usage: node training/language-model/decision-credit/run.mjs <encoder> <model.gguf> <private-progress-directory> <public-result-directory>');
}
await mkdir(work,{recursive:true});
await mkdir(destination,{recursive:true});
const signature = await sourceHash();
const path = join(work,'decision-credit-progress.json');
async function save(file,data) {
  await writeFile(file + '.tmp',JSON.stringify(data) + '\n');
  await rename(file + '.tmp',file);
}
let state;
try { state = JSON.parse(await readFile(path,'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (state && state.signature !== signature) throw new Error('Progress belongs to a different source fingerprint');
state ??= {signature,adapter:null,optimizer:{steps:0},training:[],validation:[],validationPending:[],cases:[],
  compute:{trainingSeconds:0,validationSeconds:0,evaluationSeconds:0,trainingToolCalls:0,
    counterfactualBranches:0,counterfactualToolCalls:0,uncachedForwards:0,promptTokens:0,evaluatedTokens:0,cacheHits:0}};

const worker = await openEncoder(binary,weights,model.sha256);
process.once('SIGTERM', () => process.exit(143));
process.once('SIGINT', () => process.exit(130));
const cache = new Map();
async function encode(prompt) {
  if (cache.has(prompt)) { state.compute.cacheHits++; return cache.get(prompt); }
  const {h,logits,evaluated,tokens} = await worker.encode(prompt);
  const value = {h,logits};
  if (cache.size >= 3000) cache.delete(cache.keys().next().value);
  cache.set(prompt,value);
  state.compute.uncachedForwards++;
  state.compute.promptTokens += tokens;
  state.compute.evaluatedTokens += evaluated;
  return value;
}
const play = options => episode({...options,state,encode});

async function validate(at) {
  if (!protocol.validationEpisodes.includes(at) || state.validation.some(v => v.episode === at)) return;
  const total = protocol.validationSeedsPerFamily * protocol.trainFamilies.length;
  for (let i=state.validationPending.length; i<total; i++) {
    const start = performance.now();
    const family = protocol.trainFamilies[i % protocol.trainFamilies.length];
    const seed = protocol.validationSeedStart + i;
    const run = await play({seed,family,mode:'trained'});
    state.validationPending.push({seed,family,...run.metrics,actions:run.actions});
    state.compute.validationSeconds += (performance.now()-start)/1000;
    await save(path,state);
  }
  const rows = state.validationPending;
  const point = {episode:at,...summarize(rows),cases:rows,trainingCalls:state.compute.trainingToolCalls,
    counterfactualCalls:state.compute.counterfactualToolCalls};
  state.validation.push(point);
  state.validationPending = [];
  await save(path,state);
  console.log('Decision-credit validation',at,point.successes,'/',point.episodes);
}

try {
  await validate(state.training.length);
  for (let i=state.training.length; i<protocol.trainEpisodes; i++) {
    const start = performance.now();
    const family = protocol.trainFamilies[i % protocol.trainFamilies.length];
    const seed = protocol.trainSeedStart+i;
    const random = randomStream(protocol.trainingSeed+104729*(i+1));
    const run = await play({seed,family,mode:'collect',random});
    state.training.push({episode:i+1,seed,family,metrics:run.metrics,actions:run.actions,
      credits:run.credits,updates:run.updates,branches:run.branchCount,counterfactualToolCalls:run.branchToolCalls});
    state.compute.trainingSeconds += (performance.now()-start)/1000;
    state.compute.trainingToolCalls += run.metrics.toolCalls;
    state.compute.counterfactualBranches += run.branchCount;
    state.compute.counterfactualToolCalls += run.branchToolCalls;
    await save(path,state);
    console.log('Decision-credit training',i+1,'/',protocol.trainEpisodes,run.metrics.fulfilled+'/'+run.metrics.totalDemand,
      'units,',run.branchCount,'candidate branches,',Math.round(state.compute.trainingSeconds),'cumulative seconds');
    await validate(i+1);
  }
  const total = protocol.testSeedsPerFamily * protocol.testFamilies.length;
  for (let i=state.cases.length; i<total; i++) {
    const start=performance.now();
    const family=protocol.testFamilies[i % protocol.testFamilies.length];
    const seed=protocol.testSeedStart+i;
    const capture=i===protocol.testFamilies.indexOf('compound');
    const row={seed,family,actions:{},choices:{}};
    for (const mode of ['base','trained','dispatcher']) {
      const run=await play({seed,family,mode,capture});
      row[mode]=run.metrics;
      row.actions[mode]=run.actions;
      if (mode!=='dispatcher') row.choices[mode]=run.choices;
      if (capture) await save(join(destination,'trace-'+mode+'.json'),{seed,family,mode,metrics:run.metrics,trace:run.trace});
    }
    state.cases.push(row);
    state.compute.evaluationSeconds += (performance.now()-start)/1000;
    await save(path,state);
    console.log('Decision-credit held-out case',i+1,'/',total);
  }
  const summary={};
  for (const mode of ['base','trained','dispatcher']) summary[mode]=summarize(state.cases.map(row=>row[mode]));
  await save(join(destination,'adapter.json'),{modelSha256:model.sha256,sourceSha256:signature,...state.adapter});
  const adapterSha256 = createHash('sha256').update(await readFile(join(destination,'adapter.json'))).digest('hex');
  await save(join(destination,'results.json'),{protocol,signature,adapterSha256,modelSha256:model.sha256,worldVersion:WORLD_VERSION,
    schedule:'decision-credit',summary,training:state.training,validation:state.validation,cases:state.cases,
    compute:{...state.compute,optimizerSteps:state.optimizer.steps,platform:platform(),architecture:arch(),
      processor:cpus()[0]?.model,osRelease:release(),node:process.version}});
  console.log(JSON.stringify(summary));
} finally { worker.close(); }
