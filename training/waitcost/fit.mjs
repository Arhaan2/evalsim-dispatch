import { WAITCOST_SUITE, WAITCOST_PATTERNS, PRICE_CENTS, createWaitcost, observeWaitcost, stepWaitcost } from "../../docs/lib/waitcost.js";
import { loadchoiceReferences } from "../../docs/lib/loadchoice-benchmark.js";
import { boardKey, gateKey, sixKey, sevenKey, waitValues } from "../../docs/lib/lastslot-policy.js";
import { trainingMarkets } from "../../docs/lib/paid-policy.js";
import { prng } from "../protocol.mjs";

export const FIT_SPEC = Object.freeze({
  blockSize:12000, sizes:[3000,3000,3000,1000], shrinkage:24, penalties:[0,0.5,1],
  profiles:[["balanced",[1,1,1,1]],["cold-priority",[2,4,2,1]]], opening:"tariff",
});
const GATES=288, SIX=16, SEVEN=288;
const strict=["stochastic","booking","survey"];
const retained=["loadchoice","lastslot","tariff","paid","rally","trust","drift","turns"];
const round = n => Math.round(n*1e6)/1e6;

function splitSeeds(start,seed) {
  const draw=prng(seed),ids=Array.from({length:FIT_SPEC.blockSize},(_,i)=>start+i);
  let offset=0;
  return FIT_SPEC.sizes.map(size=>{
    const begin=offset;
    for(;offset<begin+size;offset++) {
      const j=offset+Math.floor(draw()*(ids.length-offset));
      [ids[offset],ids[j]]=[ids[j],ids[offset]];
    }
    return ids.slice(begin,offset);
  });
}

// The pass-through training logger records signed freight and a legitimately
// purchased reading. No family or outcome data enter the deployed state key.
function observedTape(config) {
  const state=createWaitcost(config);
  let o=observeWaitcost(state);
  while(!o.done) o=stepWaitcost(state,o.phase==="survey"?"buy":"pass");
  const h=o.history,key=boardKey(h[0].quote);
  let bits=0;
  for(let w=0;w<5;w++) bits|=Number(h[w].high)<<w;
  const gate=gateKey(Math.round(10*h[3].quote.highChance),bits),six=sixKey(o.reading,h[5].high);
  return {key,gate,six,seven:sevenKey(six,Math.round(10*h[6].quote.highChance),h[6].high),
    lastHigh:Number(h[7].high),prices:h.slice(5).map(v=>[v.quote.low,v.quote.high])};
}
function collect(seeds,markets) {
  const boards={};
  for(const {family,group} of markets) for(const seed of seeds) {
    const t=observedTape({family,seed,priceCents:0}),at=t.gate*SEVEN+t.seven;
    const board=boards[t.key]??={prices:t.prices,groups:Array.from({length:4},()=>new Map())};
    const map=board.groups[group],bin=map.get(at)??[0,0];
    bin[0]++;bin[1]+=t.lastHigh;map.set(at,bin);
  }
  return boards;
}
function mix(board,weights) {
  const pairs=new Map();
  let raw=0,mass=0;
  for(const [g,entries] of board.groups.entries()) for(const [key,[n,high]] of entries) {
    const bin=pairs.get(key)??[0,0];bin[0]+=weights[g]*n;bin[1]+=weights[g]*high;pairs.set(key,bin);
    raw+=n;mass+=weights[g]*n;
  }
  return Array.from(pairs,([key,[n,high]])=>({gate:Math.floor(key/SEVEN),j:key%SEVEN,
    n:n*raw/mass,high:high*raw/mass}));
}
function freight(base,prices,g,s,j,guard,penalty) {
  const q=base[g],p6=prices[0][s%2],p7=prices[1][j%2];
  if(p6>=q[s] || reverts(guard[g][s],penalty)) return 6;
  if(p7>=q[SIX+j] || reverts(guard[g][SIX+j],penalty)) return 7;
  return 8;
}
const reverts=(e,penalty)=>e!=null && e[0]-penalty*e[1]<=0;
function eligible(q,p6,p7,s,j,stage) {
  return stage===7 ? p7<q[SIX+j] && p7>=q[SIX+j%36] : p6<q[s] && p6>=q[s%2];
}
function riskKeys(g,s,j,stage) {
  const first=1+Math.floor(g/32), reading=Math.floor(s/2)-1;
  const band=reading<=1?0:reading<=4?1:2;
  const later=stage===7?"/"+Math.floor(j%18/2)+"/"+(j%2):"";
  return ["*",Math.floor((first-1)/3)+"/"+(s%2),
    [first,band,s%2].join("/")+later, [first,(g>>1)&3,reading,s%2].join("/")+later, g+"/"+(stage===7?j:s)];
}
function update(map,key,values) {
  let a=map.get(key);
  if(!a) {a=new Float64Array(values.length);map.set(key,a);}
  for(let i=0;i<a.length;i++) a[i]+=values[i];
}
function predict(maps,keys) {
  let mean=null;
  for(const [l,key] of keys.entries()) {
    const bin=maps[l].get(key);
    if(!bin || !bin[0]) continue;
    const prior=mean?FIT_SPEC.shrinkage:0;
    mean=Array.from(bin.subarray(1),(v,i)=>(v+prior*(mean?.[i]??0))/(bin[0]+prior));
  }
  return mean?.map(round);
}

// Estimate the paired value and downside of a proposed wait, restricted to
// public positions where the frozen blind dispatcher would take this load.
function fitStage(stage,patterns,base,prices,guard,penalty) {
  const maps=Array.from({length:5},()=>new Map());
  for(const {gate:g,j,n,high} of patterns) {
    const s=Math.floor(j/18),p6=prices[0][s%2],p7=prices[1][j%2],q=base[g];
    if(!eligible(q,p6,p7,s,j,stage)) continue;
    const current=stage===7?p7:p6;
    const bookSeven=stage===6 && (p7>=q[SIX+j] || reverts(guard[g][SIX+j],penalty));
    const [low,hi]=bookSeven?[p7,p7]:prices[2];
    const a=low-current,b=hi-current;
    const totals=[n,(n-high)*a+high*b,
      (n-high)*Math.max(-a,0)+high*Math.max(-b,0),(n-high)*Number(a<0)+high*Number(b<0)];
    for(const [l,key] of riskKeys(g,s,j,stage).entries()) update(maps[l],key,totals);
  }
  for(let g=0;g<GATES;g++) {
    const candidates=stage===7?SEVEN:SIX,first=stage===7?36:2;
    for(let i=first;i<candidates;i++) {
      const s=stage===7?Math.floor(i/18):i,j=stage===7?i:18*i;
      if(!eligible(base[g],prices[0][s%2],prices[1][j%2],s,j,stage)) continue;
      const e=predict(maps,riskKeys(g,s,j,stage));
      if(e) guard[g][stage===7?SIX+j:s]=e;
    }
  }
}

function treeKeys(base,prices,guard,penalty) {
  return base.map((_,g)=>{
    const tree=[],blind=[];
    for(let j=36;j<SEVEN;j++) {
      const s=Math.floor(j/18);
      tree.push(freight(base,prices,g,s,j,guard,penalty));
      blind.push(freight(base,prices,g,s%2,j%36,guard,penalty));
    }
    // Distinguish equivalent decision trees at the gate, before any reading
    // arrives. If both branches agree everywhere, the survey pays zero gross.
    const informed=tree.join(""),skipped=blind.join("");
    return {signature:skipped+"/"+informed,equivalent:informed===skipped};
  });
}
function gateKeys(g,shape) {
  return ["*",shape.signature,Math.floor(g/32)+"/"+shape.signature,g];
}
export function fitBoard(seven,six,cal,oldRows,prices,penalty) {
  const base=oldRows.map(waitValues),guard=Array.from({length:GATES},()=>({}));
  fitStage(7,seven,base,prices,guard,penalty);
  fitStage(6,six,base,prices,guard,penalty);
  const shapes=treeKeys(base,prices,guard,penalty),maps=Array.from({length:4},()=>new Map());
  for(const {gate:g,j,n,high} of cal) {
    const s=Math.floor(j/18), blind=freight(base,prices,g,s%2,j%36,guard,penalty),
      informed=freight(base,prices,g,s,j,guard,penalty);
    const returns={6:n*prices[0][s%2],7:n*prices[1][j%2],8:(n-high)*prices[2][0]+high*prices[2][1]};
    const values=[n,returns[blind],returns[informed]-returns[blind]];
    for(const [l,key] of gateKeys(g,shapes[g]).entries()) update(maps[l],key,values);
  }
  return shapes.map((shape,g)=>{
    const [skip,increment]=predict(maps,gateKeys(g,shape));
    return {skip,delta:shape.equivalent?0:increment,guard:guard[g]};
  });
}

function runReference(config,policy) {
  const state=createWaitcost(config);
  let o=observeWaitcost(state),slots,gross;
  while(!o.done) {
    if(o.phase==="survey") {slots=o.slots;gross=state.grossCents;}
    o=stepWaitcost(state,policy(o));
  }
  return {net:state.netCents,slots,gross};
}
function selectTapes(families,seeds,priors) {
  const old=loadchoiceReferences(priors),controls={...old,loadchoice:old.rl},tapes=[];
  for(const {family,group} of families) {
    if(group===3) continue;
    for(const seed of seeds) {
      const c={family,seed,priceCents:0},t=observedTape(c);
      const fixed={};
      if(group===2) for(const name of [...strict,"rally","trust","drift","turns"]) fixed[name]=runReference(c,controls[name]).net;
      const prices=[];
      for(const cents of PRICE_CENTS) {
        if(group!==2 && !cents) continue;
        const priced={...c,priceCents:cents},skip=runReference(priced,old.rlNever);
        const refs=group===2?{...fixed}:{planner:runReference(priced,old.planner).net};
        if(group===2) for(const name of ["loadchoice","lastslot","tariff","paid"]) refs[name]=runReference(priced,controls[name]).net;
        prices.push({cents,skip,refs});
      }
      tapes.push({...t,group,tariffs:prices});
    }
  }
  return tapes;
}
function selectionScore(boards,prior,tapes,penalty) {
  const sums=Array.from({length:3},()=>({rl:0,never:0})),counts=[0,0,0];
  const models=Object.fromEntries(Object.entries(boards).map(([key,rows])=>[key,{
    guard:rows.map(r=>r.guard),base:prior.boards[key].map(waitValues)}]));
  for(const t of tapes) {
    const {group,key,gate:g,six:s,seven:j,prices}=t,row=boards[key][g],m=models[key];
    const w=freight(m.base,prices,g,s,j,m.guard,penalty);
    const net=prices[w-6][w===6?s%2:w===7?j%2:t.lastHigh];
    for(const {cents,skip,refs} of t.tariffs) {
      const buy=skip.slots===1 && row.delta-cents/100>1e-10;
      sums[group].rl+=buy?skip.gross+100*net-cents:skip.net;
      sums[group].never+=skip.net;
      for(const [name,total] of Object.entries(refs)) sums[group][name]=(sums[group][name]??0)+total;
      counts[group]++;
    }
  }
  const means=sums.map((s,g)=>Object.fromEntries(Object.entries(s).map(([k,n])=>[k,n/(100*counts[g])])));
  const [hot,cold,recovery]=means;
  const slacks=[cold.rl-cold.never,cold.rl-cold.planner,hot.rl-hot.planner,
    Math.min(...strict.map(k=>recovery.rl-recovery[k]),...retained.map(k=>1+recovery.rl-recovery[k]))];
  return {means,counts,slacks,minimum:Math.min(...slacks),average:slacks.reduce((a,b)=>a+b,0)/slacks.length};
}
export function fitWaitcost(index,seed,priors) {
  const train=WAITCOST_SUITE.splits.train;
  if(!Number.isInteger(index) || index<0 || (index+1)*FIT_SPEC.blockSize>train.count) throw new RangeError("Unknown training block.");
  const blockStart=train.start+index*FIT_SPEC.blockSize;
  const [seeds7,seeds6,seedsGate,seedsSelect]=splitSeeds(blockStart,seed);
  const {fit,selection:held}=trainingMarkets(train.families,WAITCOST_PATTERNS);
  const seven=collect(seeds7,fit),six=collect(seeds6,fit),gate=collect(seedsGate,fit);
  const selection=selectTapes(held,seedsSelect,priors),candidates=[];
  let weights,winner;
  for(const [profile,multipliers] of FIT_SPEC.profiles) {
    const data=Object.fromEntries(Object.keys(seven).map(key=>[key,
      [mix(seven[key],multipliers),mix(six[key],multipliers),mix(gate[key],multipliers)]]));
    for(const penalty of FIT_SPEC.penalties) {
      const boards=Object.fromEntries(Object.entries(data).map(([key,banks])=>[key,
        fitBoard(...banks,priors.loadchoice.boards[key],seven[key].prices,penalty)]));
      const metric={profile,multipliers,penalty,...selectionScore(boards,priors.loadchoice,selection,penalty)};
      candidates.push(metric);
      if(!winner || metric.minimum>winner.minimum || (metric.minimum===winner.minimum && metric.average>winner.average)) {
        winner=metric;weights={profile,penalty,opening:FIT_SPEC.opening,boards};
      }
    }
  }
  return {weights,trainingCounts:{trainingSeed:seed,blockStart,blockSize:FIT_SPEC.blockSize,sevenSeeds:seeds7.length,
    sixSeeds:seeds6.length,calibrationSeeds:seedsGate.length,selectionSeeds:seedsSelect.length,
    fitFamilies:fit.map(x=>x.family),selectionFamilies:held.filter(x=>x.group<3).map(x=>x.family),
    sevenShifts:fit.length*seeds7.length,sixShifts:fit.length*seeds6.length,calibrationShifts:fit.length*seedsGate.length,
    selectionShifts:selection.length,selectionPriceCases:winner.counts.reduce((a,b)=>a+b,0)},
    selection:{profile:winner.profile,penalty:winner.penalty,opening:FIT_SPEC.opening,candidates,
      slackNames:["coldVsNever","coldVsPlanner","hotVsPlanner","recovery"]}};
}
