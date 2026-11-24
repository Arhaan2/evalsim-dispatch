import { createTariff, observeTariff, stepTariff, TARIFF_PATTERNS, TARIFF_SUITE, PRICE_CENTS } from "../../docs/lib/tariff.js";
import { paidEvidence, trainingMarkets } from "../../docs/lib/paid-policy.js";
import { chooseTariffPlanner, tariffKeys, tariffRow } from "../../docs/lib/tariff-policy.js";
import { paidReferences } from "../../docs/lib/paid-benchmark.js";
import { prng } from "../protocol.mjs";

export const FIT_SPEC = Object.freeze({
  blockSize:12000, tailSeeds:2000, earlySeeds:2000, selectionSeeds:1000, shrinkage:48, minimumExactMass:12,
  profiles:[["equal",null],["hot",[4,1,1,1]],["cold",[1,4,1,1]],["recovery",[1,1,4,1]],
    ["hot-cold",[4,4,1,1]],["hot-recovery",[4,1,4,1]],["cold-recovery",[1,4,4,1]],["all-targets",[4,4,4,1]]],
});
const groupNames = ["hotDrops","coldReversals","recovery","other"];
const historical = ["stochastic","booking","survey","rally","trust","drift","turns"];
const referenceNames = ["planner","paid",...historical];
const choose6 = [1,6,15,20,15,6,1];

function banks(seed,start) {
  const rng = prng(seed), bank = Array.from({length:FIT_SPEC.blockSize},(_,i)=>start+i);
  const {tailSeeds, earlySeeds, selectionSeeds} = FIT_SPEC;
  for (let i=0;i<tailSeeds+earlySeeds+selectionSeeds;i++) {
    const j=i+Math.floor(rng()*(bank.length-i));
    [bank[i],bank[j]]=[bank[j],bank[i]];
  }
  return [bank.slice(0,tailSeeds),bank.slice(tailSeeds,tailSeeds+earlySeeds),
    bank.slice(tailSeeds+earlySeeds,tailSeeds+earlySeeds+selectionSeeds)];
}
function layer(size) {
  return {ids:new Uint32Array(size), prices:new Uint8Array(size), nodes:[], keys:new Map(),
    contextIds:new Map(), contexts:[], leaf:[]};
}
function record(layer,i,e,price) {
  const signature = [e.low,e.high,e.bits,e.first,e.second,e.reading].join("/");
  let id=layer.contextIds.get(signature);
  if (id===undefined) {
    id=layer.contexts.length;
    layer.contextIds.set(signature,id);
    layer.contexts.push(e);
    let parent=-1;
    for (const key of tariffKeys(e)) {
      let ix=layer.keys.get(key);
      if (ix===undefined) {
        ix=layer.nodes.length;
        layer.nodes.push({key,parent});
        layer.keys.set(key,ix);
      }
      parent=ix;
    }
    layer.leaf.push(parent);
  }
  layer.ids[i]=id;
  layer.prices[i]=price;
}

function controls(weights) {
  const previous=paidReferences(weights);
  return [
    ...PRICE_CENTS.flatMap(cents => [
      {name:"planner",cents,choose:o=>chooseTariffPlanner(o,null)},
      {name:"paid",cents,choose:previous.rl}]),
    ...historical.map(name=>({name,cents:0,choose:previous[name]})),
  ];
}

function referenceStep(o,policies,slots,nets,bought) {
  for (const [j,p] of policies.entries()) {
    if (!slots[j]) continue;
    const gotReading=bought[j]===1;
    const obs={...o,slots:slots[j],priceCents:p.cents,surveyFee:p.cents/100,
      gross:(nets[j]+(gotReading ? p.cents : 0))/100,net:nets[j]/100,
      feePaid:gotReading ? p.cents/100 : 0,reading:gotReading ? o.reading : null,
      surveyAction:o.wave<5 || o.phase==="survey" ? null : gotReading ? "buy" : "skip"};
    const action=p.choose(obs);
    if (action==="buy") { bought[j]=1; nets[j]-=p.cents; }
    if (action==="accept") { slots[j]--; nets[j]+=100*o.offer.net; }
  }
}

// The final offer is always accepted with capacity left. For fitting, replace
// its sampled reward with its conditional expectation and integrate every fresh
// survey count over its binomial law, leaving all other freight draws untouched.
// Selection sees the single actual reading and actual final offer on each tape.
function collect(seeds,markets,part,weights) {
  const n=seeds.length*markets.length, head=part!=="tail", selection=part==="selection";
  const branches=selection ? 2 : 8;
  const stages=Array.from({length:7},(_,w)=>w>=5 ? layer(branches*n) : head ? layer(n) : null);
  const last=new Float64Array(n*branches), branchMass=new Float64Array(n*branches);
  const gate=head ? layer(n) : null, group=new Uint8Array(n), counts=[0,0,0,0];
  const totals=groupNames.map(()=>Object.fromEntries(referenceNames.map(k=>[k,0])));
  const policies=selection ? controls(weights) : [];
  let i=0;
  for (const m of markets) for (const seed of seeds) {
    const state=createTariff({family:m.family, seed, priceCents:0});
    let o=observeTariff(state);
    const slots=new Uint8Array(policies.length).fill(2), nets=new Int32Array(policies.length), bought=new Uint8Array(policies.length);
    const p=selection ? null : state.trueHighChances[5];
    branchMass[i]=1;
    for (let b=1;b<branches;b++) {
      const k=b-1;
      branchMass[i+b*n]=selection ? 1 : choose6[k]*p**k*(1-p)**(6-k);
    }
    while (!o.done) {
      if (selection) referenceStep(o,policies,slots,nets,bought);
      if (o.phase==="survey") {
        if (head) record(gate,i,paidEvidence(o),0);
        o=stepTariff(state,"buy");
        continue;
      }
      const w=o.wave, price=o.offer.net;
      if (w===7) {
        const expectation=selection ? price : o.quote.low+(o.quote.high-o.quote.low)*state.trueHighChances[7];
        for (let b=0;b<branches;b++) last[i+b*n]=expectation;
      } else if (w>=5) {
        const e=paidEvidence(o);
        record(stages[w],i,{...e,reading:-1},price);
        for (let b=1;b<branches;b++) record(stages[w],i+b*n,{...e,reading:selection ? e.reading : b-1},price);
      } else if (head) record(stages[w],i,paidEvidence(o),price);
      o=stepTariff(state,"pass");
    }
    for (const [j,policy] of policies.entries()) {
      // A historical policy is identical at all prices and skips every gate.
      const repetitions=historical.includes(policy.name) ? PRICE_CENTS.length : 1;
      totals[m.group][policy.name]+=nets[j]*repetitions;
    }
    counts[m.group]++;
    group[i++]=m.group;
  }
  return {n,stages,gate,last,branchMass,branches,group,counts,totals};
}

function regress(layer,columns,data,masses) {
  const d=1+columns.length, sums=new Float64Array(layer.nodes.length*d);
  const weights=data.counts.map((count,g)=>masses ? data.n*masses[g]/(count*masses.reduce((a,b)=>a+b,0)) : 1);
  for (let i=0;i<layer.ids.length;i++) {
    const w=weights[data.group[i%data.n]]*data.branchMass[i], k=d*layer.leaf[layer.ids[i]];
    sums[k]+=w;
    for(let j=0;j<columns.length;j++) sums[k+j+1]+=w*columns[j][i];
  }
  for (let i=layer.nodes.length-1;i>0;i--) {
    const k=d*i, p=d*layer.nodes[i].parent;
    for(let j=0;j<d;j++) sums[p+j]+=sums[k+j];
  }
  const estimates=[],table={};
  for(const [i,node] of layer.nodes.entries()) {
    const k=d*i,parent=estimates[node.parent], prior=parent ? FIT_SPEC.shrinkage : 0;
    if (node.key.startsWith("exact:") && sums[k] < FIT_SPEC.minimumExactMass) {
      estimates.push(parent);
      continue;
    }
    const row=columns.map((_,j)=>(sums[k+j+1]+(parent ? prior*parent[j] : 0))/(sums[k]+prior));
    table[node.key]=row;
    estimates.push(row);
  }
  return {table,lookup:layer.leaf.map(i=>estimates[i])};
}
const lookup = (layer,table)=>layer.contexts.map(e=>tariffRow(table,e));

// Carry fractional next-state returns throughout the recursion. Neither a
// sub-credit charge nor a marginalized outcome may be truncated to integers.
function freightRoll(layer,values,next) {
  const returns=[new Float64Array(layer.ids.length),new Float64Array(layer.ids.length)];
  for (let i=0;i<layer.ids.length;i++) {
    const v=values[layer.ids[i]], price=layer.prices[i];
    returns[0][i]=price>=v[0]-1e-10 ? price : next[0][i];
    returns[1][i]=price+v[0]>=v[1]-1e-10 ? price+next[0][i] : next[1][i];
  }
  return returns;
}
function continuation(data,model) {
  let next=[data.last,data.last];
  for (let w=6;w>=5;w--) {
    const layer=data.stages[w];
    next=freightRoll(layer,lookup(layer,model.tail[w-5]),next);
  }
  const [one,two]=next, n=data.n;
  const columns=[one.subarray(0,n),two.subarray(0,n),new Float64Array(n),new Float64Array(n)];
  for (let b=1;b<data.branches;b++) for (let i=0;i<n;i++) {
    const k=i+b*n;
    columns[2][i]+=data.branchMass[k]*one[k];
    columns[3][i]+=data.branchMass[k]*two[k];
  }
  return columns;
}
function gateRoll(data,columns,lookup,cents) {
  const future=[new Float64Array(data.n),new Float64Array(data.n)], fee=cents/100;
  for (let i=0;i<data.n;i++) {
    const v=lookup[data.gate.ids[i]];
    for(let j=0;j<2;j++) future[j][i]=v[2+j]-v[j]>fee+1e-10 ? columns[2+j][i]-fee : columns[j][i];
  }
  return future;
}
function fitCandidate(suffix,opening,profile,masses) {
  const model={profile,tail:Array(2),early:{},gate:null};
  let next=[suffix.last,suffix.last];
  for (let w=6;w>=5;w--) {
    const layer=suffix.stages[w], estimate=regress(layer,next,suffix,masses);
    model.tail[w-5]=estimate.table;
    next=freightRoll(layer,estimate.lookup,next);
  }
  const columns=continuation(opening,model);
  const gate=regress(opening.gate,columns,opening,masses);
  model.gate=gate.table;
  for(const cents of PRICE_CENTS) {
    let future=gateRoll(opening,columns,gate.lookup,cents);
    const stages=Array(5);
    for(let w=4;w>=0;w--) {
      const layer=opening.stages[w],estimate=regress(layer,future,opening,masses);
      stages[w]=estimate.table;
      future=freightRoll(layer,estimate.lookup,future);
    }
    model.early[cents]=stages;
  }
  return model;
}
function score(model,data,comparisonMeans) {
  const columns=continuation(data,model), gate=lookup(data.gate,model.gate);
  const totals=[0,0,0,0];
  for (const cents of PRICE_CENTS) {
    let future=gateRoll(data,columns,gate,cents);
    for(let w=4;w>=0;w--) {
      const layer=data.stages[w];
      future=freightRoll(layer,lookup(layer,model.early[cents][w]),future);
    }
    for(let i=0;i<data.n;i++) totals[data.group[i]]+=Math.round(100*future[1][i]);
  }
  const means=totals.map((v,g)=>v/(100*PRICE_CENTS.length*data.counts[g]));
  const [hot,cold,original]=means.map((v,g)=>Object.fromEntries(referenceNames.map(k=>[k,v-comparisonMeans[groupNames[g]][k]])));
  const slacks=[hot.planner,cold.planner,Math.min(original.stochastic,original.booking,original.survey,
    ...["paid","rally","trust","drift","turns"].map(k=>original[k]+1))];
  return {profile:model.profile,meanNet:Object.fromEntries(groupNames.map((g,i)=>[g,means[i]])),slacks,
    minimum:Math.min(...slacks),average:slacks.reduce((a,b)=>a+b,0)/slacks.length};
}
export function fitTariff(index,seed,priorWeights) {
  const train=TARIFF_SUITE.splits.train;
  if(!Number.isInteger(index) || index<0 || (index+1)*FIT_SPEC.blockSize>train.count) throw new RangeError("Unknown fit block.");
  const blockStart=train.start+index*FIT_SPEC.blockSize;
  const [tailSeeds,earlySeeds,selectionSeeds]=banks(seed,blockStart);
  const {fit,selection:held}=trainingMarkets(train.families,TARIFF_PATTERNS);
  const suffix=collect(tailSeeds,fit,"tail"),opening=collect(earlySeeds,fit,"early");
  const validation=collect(selectionSeeds,held,"selection",priorWeights);
  const comparisonMeans=Object.fromEntries(groupNames.map((key,i)=>[key,Object.fromEntries(
    referenceNames.map(k=>[k,validation.totals[i][k]/(100*PRICE_CENTS.length*validation.counts[i])]))]));
  let weights,winner;
  const candidates=[];
  for(const [profile,masses] of FIT_SPEC.profiles) {
    const model=fitCandidate(suffix,opening,profile,masses), metrics=score(model,validation,comparisonMeans);
    candidates.push({...metrics,masses});
    if (!winner || metrics.minimum>winner.minimum || (metrics.minimum===winner.minimum && metrics.average>winner.average)) {
      weights=model; winner=metrics;
    }
  }
  return {weights,trainingCounts:{trainingSeed:seed,blockStart,blockSize:FIT_SPEC.blockSize,tailSeeds:tailSeeds.length,
    earlySeeds:earlySeeds.length,selectionSeeds:selectionSeeds.length,fitFamilies:fit.map(x=>x.family),
    selectionFamilies:held.map(x=>x.family),tailShifts:suffix.n,earlyShifts:opening.n,selectionShifts:validation.n,
    earlyPriceCases:PRICE_CENTS.length*opening.n,selectionPriceCases:PRICE_CENTS.length*validation.n},
    selection:{profile:winner.profile,candidates,comparisonMeans,groupNames,slackNames:["hotDrops","coldReversals","recovery"]}};
}
