import { createPaid, observePaid, stepPaid, PAID_PATTERNS, PAID_SUITE, SURVEY_FEE } from "../../docs/lib/paid.js";
import { choosePaidPlanner, paidEvidence, paidRow, POLICY_SPEC, returnKeys, trainingMarkets } from "../../docs/lib/paid-policy.js";
import { bookingReferences } from "../../docs/lib/booking-benchmark.js";
import { prng } from "../protocol.mjs";

export const FIT_SPEC = Object.freeze({ blockSize:12000, tailSeeds:2000, earlySeeds:2000, selectionSeeds:1000,
  hotMasses:[1,4,12], recoveryMasses:[1,4,12], coldMass:4, otherMass:1, shrinkage:POLICY_SPEC.shrinkage });
const groups=["hotDrops","coldReversals","recovery","other"];
const references=["planner","stochastic","booking","survey","rally","trust","drift","turns"];

function banks(seed,start) {
  const rng=prng(seed), bank=Array.from({length:FIT_SPEC.blockSize},(_,i)=>start+i);
  const {tailSeeds,earlySeeds,selectionSeeds}=FIT_SPEC;
  for (let i=0; i<tailSeeds+earlySeeds+selectionSeeds; i++) {
    const j=i+Math.floor(rng()*(bank.length-i));
    [bank[i],bank[j]]=[bank[j],bank[i]];
  }
  return [bank.slice(0,tailSeeds),bank.slice(tailSeeds,tailSeeds+earlySeeds),bank.slice(tailSeeds+earlySeeds,tailSeeds+earlySeeds+selectionSeeds)];
}
function layer(n) {
  return { ids:new Uint32Array(n), prices:new Uint8Array(n), keys:new Map(), nodes:[],
    contextIds:new Map(), contexts:[], leaf:[] };
}
function record(layer,i,e,price) {
  const signature=[e.low,e.high,e.bits,e.first,e.second,e.reading].join("/");
  let id=layer.contextIds.get(signature);
  if (id===undefined) {
    id=layer.contexts.length;
    layer.contextIds.set(signature,id);
    layer.contexts.push(e);
    let parent=-1;
    for (const key of returnKeys(e)) {
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
function collect(seeds,markets,part,priorWeights) {
  const n=seeds.length*markets.length, head=part!=="tail";
  const stages=Array.from({length:7},(_,w)=>w>=5 ? layer(2*n) : head ? layer(n) : null);
  const gate=head ? layer(n) : null, last=new Int16Array(2*n);
  const group=new Uint8Array(n), counts=[0,0,0,0];
  const totals=groups.map(()=>Object.fromEntries(references.map(r=>[r,0])));
  let refs;
  if (part==="selection") {
    const prev=bookingReferences(priorWeights);
    refs={planner:o=>choosePaidPlanner(o,null), stochastic:prev.stochastic, booking:prev.rl, survey:prev.survey,
      rally:prev.rally,trust:prev.trust,drift:prev.drift,turns:prev.turns};
  }
  let i=0;
  for (const m of markets) for (const seed of seeds) {
    const state=createPaid({family:m.family,seed});
    let o=observePaid(state);
    const slots=refs ? references.map(()=>2) : null, nets=refs ? references.map(()=>0) : null;
    let plannerBuy=false;
    while (!o.done) {
      const quote=o.offer?.net ?? 0;
      if (o.phase==="survey") {
        if (head) record(gate,i,paidEvidence(o),0);
        if (refs) {
          plannerBuy=refs.planner({...o,slots:slots[0],net:nets[0]})==="buy";
          if (plannerBuy) nets[0]-=SURVEY_FEE;
        }
        o=stepPaid(state,"buy");
        continue;
      }
      const wave=o.wave;
      if (wave===7) last[i]=last[i+n]=quote;
      else if (head || wave>=5) {
        const e=paidEvidence(o);
        if (wave>=5) record(stages[wave],i+n,e,quote);
        record(stages[wave],i,{...e,reading:-1},quote);
      }
      if (refs) {
        for (const [j,name] of references.entries()) {
          if (!slots[j]) continue;
          const bought=j===0 && plannerBuy;
          const obs={...o,slots:slots[j],net:nets[j],gross:nets[j]+(bought ? SURVEY_FEE : 0),
            reading:bought ? o.reading : null,feePaid:bought ? SURVEY_FEE : 0,
            surveyAction:wave<5 ? null : bought ? "buy" : "skip"};
          if (refs[name](obs)==="accept") { nets[j]+=quote; slots[j]--; }
        }
      }
      o=stepPaid(state,"pass");
    }
    if (refs) for (const [j,name] of references.entries()) totals[m.group][name]+=nets[j];
    counts[m.group]++; group[i++]=m.group;
  }
  return {n,stages,gate,last,group,counts,totals};
}

// Each column is a same-tape continuation return. A root-to-leaf hierarchy
// borrows support from coarser public histories for sparse observation cells.
function regress(layer,columns,data,masses) {
  const d=1+columns.length;
  const sums=new Float64Array(layer.nodes.length*d);
  const weights=data.counts.map((n,g)=>masses ? data.n*masses[g]/(n*masses.reduce((a,b)=>a+b,0)) : 1);
  for (let i=0; i<layer.ids.length; i++) {
    const weight=weights[data.group[i%data.n]];
    const k=d*layer.leaf[layer.ids[i]];
    sums[k]+=weight;
    for (let j=0; j<columns.length; j++) sums[k+j+1]+=weight*columns[j][i];
  }
  for (let i=layer.nodes.length-1; i>0; i--) {
    const k=d*i, p=d*layer.nodes[i].parent;
    for (let j=0; j<d; j++) sums[p+j]+=sums[k+j];
  }
  const rows=[], table={};
  for (const [i,node] of layer.nodes.entries()) {
    const k=d*i, parent=rows[node.parent], prior=parent ? FIT_SPEC.shrinkage : 0;
    const row=columns.map((_,j)=>(sums[k+j+1]+(parent ? prior*parent[j] : 0))/(sums[k]+prior));
    table[node.key]=row; rows.push(row);
  }
  return {table,lookup:layer.leaf.map(i=>rows[i])};
}
function lookup(layer,table) { return layer.contexts.map(e=>paidRow(table,e)); }

// Book and wait use the same future freight draws. A booking consumes one
// slot immediately. Freight rewards are integers; the survey fee is one.
function freightRoll(layer,rows,future) {
  const ret=[new Int16Array(layer.ids.length),new Int16Array(layer.ids.length)];
  for (let i=0; i<layer.ids.length; i++) {
    const price=layer.prices[i], v=rows[layer.ids[i]];
    ret[0][i]=price>=v[0]-1e-10 ? price : future[0][i];
    ret[1][i]=price+v[0]>=v[1]-1e-10 ? price+future[0][i] : future[1][i];
  }
  return ret;
}
function tailReturns(data,model) {
  let future=[data.last,data.last];
  for (let t=6; t>=5; t--) {
    const s=data.stages[t];
    future=freightRoll(s,lookup(s,model.stages[t]),future);
  }
  return future;
}
function gateReturns(data,suffix,rows) {
  const ret=[new Int16Array(data.n),new Int16Array(data.n)];
  for (let i=0;i<data.n;i++) {
    const v=rows[data.gate.ids[i]];
    for (let j=0;j<2;j++)
      ret[j][i]=v[2+j]-SURVEY_FEE>v[j]+1e-10 ? suffix[j][i+data.n]-SURVEY_FEE : suffix[j][i];
  }
  return ret;
}
function fitCandidate(tail,early,p) {
  const stages=Array(7);
  let next=[tail.last,tail.last];
  for (let t=6;t>=5;t--) {
    const s=tail.stages[t], f=regress(s,next,tail,p.masses);
    stages[t]=f.table;
    next=freightRoll(s,f.lookup,next);
  }
  // Estimate acquisition on fresh fitting seeds. Each seed here has a
  // revealed and a masked rollout under the already fitted freight policy.
  const suffix=tailReturns(early,{stages});
  const columns=[...suffix.map(v=>v.subarray(0,early.n)),...suffix.map(v=>v.subarray(early.n))];
  const gate=regress(early.gate,columns,early,p.masses);
  next=gateReturns(early,suffix,gate.lookup);
  for (let t=4;t>=0;t--) {
    const s=early.stages[t], f=regress(s,next,early,p.masses);
    stages[t]=f.table;
    next=freightRoll(s,f.lookup,next);
  }
  return {profile:p.id,stages,gate:gate.table};
}
function selectionScore(model,data) {
  const suffix=tailReturns(data,model);
  const gate=gateReturns(data,suffix,lookup(data.gate,model.gate));
  let returns=gate;
  for (let t=4;t>=0;t--)
    returns=freightRoll(data.stages[t],lookup(data.stages[t],model.stages[t]),returns);
  const scores=[0,0,0,0];
  for (let i=0;i<data.n;i++) scores[data.group[i]]+=returns[1][i];
  const means=scores.map((s,g)=>s/data.counts[g]);
  const diff=means.map((v,g)=>Object.fromEntries(references.map(k=>[k,v-data.totals[g][k]/data.counts[g]])));
  const [hot,cold,original]=diff;
  const slacks=[hot.planner, Math.min(cold.planner,cold.survey+1,cold.booking+1),
    Math.min(original.planner,original.stochastic,original.survey,original.booking,...["rally","trust","drift","turns"].map(k=>original[k]+1))];
  return {profile:model.profile,means:Object.fromEntries(groups.map((k,i)=>[k,means[i]])),
    slacks,minimum:Math.min(...slacks),average:slacks.reduce((a,b)=>a+b,0)/3};
}
function grid() {
  const candidates=[{id:"equal",masses:null}];
  for (const hot of FIT_SPEC.hotMasses) for (const recovery of FIT_SPEC.recoveryMasses)
    candidates.push({id:"hot-"+hot+"-recovery-"+recovery,masses:[hot,FIT_SPEC.coldMass,recovery,FIT_SPEC.otherMass]});
  return candidates;
}
export function fitPaid(index,seed,priorWeights) {
  const train=PAID_SUITE.splits.train;
  if (!Number.isInteger(index) || index<0 || (index+1)*FIT_SPEC.blockSize>train.count) throw new RangeError("Unknown paid training block.");
  const blockStart=train.start+index*FIT_SPEC.blockSize, [tailSeeds,earlySeeds,selectSeeds]=banks(seed,blockStart);
  const {fit,selection:held}=trainingMarkets(train.families,PAID_PATTERNS);
  const tail=collect(tailSeeds,fit,"tail"), early=collect(earlySeeds,fit,"early");
  const selection=collect(selectSeeds,held,"selection",priorWeights);
  let weights, winner;
  const candidates=[];
  for (const p of grid()) {
    const model=fitCandidate(tail,early,p), score=selectionScore(model,selection);
    candidates.push({...score,masses:p.masses});
    if (!winner || score.minimum>winner.minimum || (score.minimum===winner.minimum && score.average>winner.average)) {
      winner=score; weights=model;
    }
  }
  const trainingCounts={trainingSeed:seed,blockStart,blockSize:FIT_SPEC.blockSize, tailSeeds:tailSeeds.length,earlySeeds:earlySeeds.length,
    selectionSeeds:selectSeeds.length, fitFamilies:fit.map(x=>x.family),selectionFamilies:held.map(x=>x.family),
    tailShifts:tail.n,earlyShifts:early.n,selectionShifts:selection.n};
  return {weights,trainingCounts,selection:{profile:winner.profile,candidates,groupNames:groups,slackNames:["hotDrops","coldReversals","recovery"],
    comparisonMeans:Object.fromEntries(selection.totals.map((totals,g)=>[groups[g],Object.fromEntries(references.map(k=>[k,totals[k]/selection.counts[g]]))]))}};
}
