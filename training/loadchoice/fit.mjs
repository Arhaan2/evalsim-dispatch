import { createLoadchoice, observeLoadchoice, stepLoadchoice, LOADCHOICE_PATTERNS, LOADCHOICE_SUITE, PRICE_CENTS } from "../../docs/lib/loadchoice.js";
import { boardKey, gateKey, sixKey, sevenKey, packWait, waitValues } from "../../docs/lib/lastslot-policy.js";
import { trainingMarkets } from "../../docs/lib/paid-policy.js";
import { lastslotReferences } from "../../docs/lib/lastslot-benchmark.js";
import { prng } from "../protocol.mjs";

export const FIT_SPEC=Object.freeze({
  blockSize:12000, sevenSeeds:3000, sixSeeds:3000, gateSeeds:3000, selectionSeeds:1000,
  shrinkage:[16,96], profiles:[["balanced",[1,1,1,1]],["targets",[2,2,1,1]],["targets-recovery",[2,2,2,1]]],
  opening:"tariff",
});
const GATES=9*32, SIX=16, SEVEN=SIX*9*2;
const strict=["stochastic","booking","survey"];
const withinOne=["lastslot","tariff","paid","rally","trust","drift","turns"];
const credit=x=>Math.round(1000*x)/1000;
const roundGate=x=>Math.round(1e6*x)/1e6;
const pair=n=>({count:new Float64Array(n),reward:new Float64Array(n)});
const band=b=>b<=3 ? 0 : b>=7 ? 2 : 1;

function splitSeeds(start,seed) {
  const {blockSize,sevenSeeds,sixSeeds,gateSeeds,selectionSeeds}=FIT_SPEC;
  const ids=Array.from({length:blockSize},(_,i)=>start+i),draw=prng(seed);
  const sizes=[sevenSeeds,sixSeeds,gateSeeds,selectionSeeds];
  let offset=0;
  return sizes.map(size=>{
    for(let i=offset;i<offset+size;i++) {
      const j=i+Math.floor(draw()*(blockSize-i));
      [ids[i],ids[j]]=[ids[j],ids[i]];
    }
    offset+=size;
    return ids.slice(offset-size,offset);
  });
}

function collect(seeds,markets) {
  const groups=Array.from({length:4},()=>pair(GATES*SEVEN)),supports=new Map();
  for(const {family,group} of markets) for(const seed of seeds) {
    const state=createLoadchoice({family,seed,priceCents:0});
    // Pass freight to log every public offer and take the reading at its legal
    // window. The same terminal trajectory supplies both blind and read views.
    let o=observeLoadchoice(state);
    while(!o.done) o=stepLoadchoice(state,o.phase==="survey"?"buy":"pass");
    const h=o.history, key=boardKey(h[0].quote);
    if(!supports.has(key)) supports.set(key,h.slice(5).map(({quote})=>[quote.low,quote.high]));
    let bits=0;
    for(let w=0;w<5;w++) bits|=Number(h[w].high)<<w;
    const gate=gateKey(Math.round(10*h[3].quote.highChance),bits);
    const six=sixKey(o.reading,h[5].high);
    const seven=sevenKey(six,Math.round(10*h[6].quote.highChance),h[6].high);
    const at=gate*SEVEN+seven;
    groups[group].count[at]++;
    groups[group].reward[at]+=Number(h[7].high);
  }
  return {groups,supports};
}

function mix(groups,weights) {
  const out=pair(GATES*SEVEN);
  let raw=0,mass=0;
  for(const [g,data] of groups.entries()) for(let i=0;i<data.count.length;i++) {
    raw+=data.count[i];
    mass+=weights[g]*data.count[i];
    out.count[i]+=weights[g]*data.count[i];
    out.reward[i]+=weights[g]*data.reward[i];
  }
  // Keep the regularizer in units of actual sampled tapes for all profiles.
  const scale=raw/mass;
  for(let i=0;i<out.count.length;i++) {out.count[i]*=scale;out.reward[i]*=scale;}
  return out;
}

// Sparse histories back off to a signed-history group and then a broad bulletin
// group. A missing reading and a measured zero are always in separate groups.
function ancestry(width,gate,stage) {
  const first=1+Math.floor(gate/32),signs=(gate>>1)&3;
  if(width===1) return [0,band(first),4*first+signs];
  const six=width===SIX ? stage : Math.floor(stage/18);
  const read=Math.floor(six/2)-1, hi6=six%2;
  const bucket=read<0?0:read<2?1:read<5?2:3;
  let broad=(4*band(first)+bucket)*2+hi6;
  let near=((4*first+signs)*8+read+1)*2+hi6;
  if(width===SEVEN) {
    const second=1+Math.floor(stage%18/2),hi7=stage%2;
    broad=(3*broad+band(second))*2+hi7;
    near=(9*near+second-1)*2+hi7;
  }
  return [Number(read>=0),broad,near];
}

const indexCache=new Map();
function indices(width) {
  if(!indexCache.has(width)) {
    const maps=Array.from({length:3},()=>new Uint16Array(GATES*width)),max=[0,0,0];
    for(let i=0;i<GATES*width;i++) {
      const keys=ancestry(width,Math.floor(i/width),i%width);
      for(let l=0;l<3;l++) {maps[l][i]=keys[l];max[l]=Math.max(max[l],keys[l]);}
    }
    indexCache.set(width,{maps,lengths:max.map(x=>x+1)});
  }
  return indexCache.get(width);
}

function smooth(data,width,regularizer) {
  const {maps,lengths}=indices(width);
  const levels=lengths.map(pair);
  let total=0,count=0;
  for(let i=0;i<data.count.length;i++) {
    if(!data.count[i]) continue;
    total+=data.reward[i];count+=data.count[i];
    for(let level=0;level<3;level++) {
      const key=maps[level][i],pool=levels[level];
      pool.count[key]+=data.count[i];pool.reward[key]+=data.reward[i];
    }
  }
  if(!count) throw new Error("Empty training bank.");
  const out=new Float64Array(data.count.length);
  for(let i=0;i<out.length;i++) {
    let mean=total/count;
    for(let level=0;level<3;level++) {
      const key=maps[level][i],pool=levels[level];
      const prior=level===0?0:regularizer;
      if(pool.count[key]) mean=(pool.reward[key]+prior*mean)/(pool.count[key]+prior);
    }
    out[i]=(data.reward[i]+regularizer*mean)/(data.count[i]+regularizer);
  }
  return out;
}

// Aggregated realized wave-eight high/low outcomes allow replay under either
// public board, drawn independently of the demand process. Compute signed
// credit returns under each board's own freight supports and stopping policy.
export function fitBoard(sevenData,sixData,gateData,prices,regularizer) {
  const [p6,p7,p8]=prices;
  const last=pair(GATES*SEVEN);
  function branches(data,visit) {
    for(let i=0;i<data.count.length;i++) {
      const n=data.count[i];
      if(!n) continue;
      const s=i%SEVEN,gate=Math.floor(i/SEVEN),six=Math.floor(s/18);
      const final=p8[0]*n+(p8[1]-p8[0])*data.reward[i];
      visit(gate,six,s,n,final);
    }
  }
  function add(data,at,n,value) {data.count[at]+=n;data.reward[at]+=value;}
  branches(sevenData,(g,s,j,n,final)=>{
    add(last,g*SEVEN+j,n,final);
    add(last,g*SEVEN+j%36,n,final);
  });
  const q7=smooth(last,SEVEN,regularizer).map(credit);
  const middle=pair(GATES*SIX);
  function seventh(g,j,n,final) {
    const offer=p7[j%2];
    return offer>=q7[g*SEVEN+j] ? n*offer : final;
  }
  branches(sixData,(g,s,j,n,final)=>{
    add(middle,g*SIX+s,n,seventh(g,j,n,final));
    add(middle,g*SIX+s%2,n,seventh(g,j%36,n,final));
  });
  const q6=smooth(middle,SIX,regularizer).map(credit);
  function freight(g,s,j,n,final) {
    const offer=p6[s%2];
    return offer>=q6[g*SIX+s] ? n*offer : seventh(g,j,n,final);
  }
  const difference=pair(GATES),blind=pair(GATES);
  branches(gateData,(g,s,j,n,final)=>{
    const skip=freight(g,s%2,j%36,n,final), informed=freight(g,s,j,n,final);
    add(difference,g,n,informed-skip);
    add(blind,g,n,skip);
  });
  const delta=smooth(difference,1,regularizer),skip=smooth(blind,1,regularizer);
  return Array.from({length:GATES},(_,g)=>({
    wait:packWait([...q6.subarray(g*SIX,(g+1)*SIX),...q7.subarray(g*SEVEN,(g+1)*SEVEN)]),
    skip:roundGate(skip[g]),delta:roundGate(delta[g]),
  }));
}

function reference(config,decide) {
  const state=createLoadchoice(config);
  let o=observeLoadchoice(state);
  while(!o.done) o=stepLoadchoice(state,decide(o));
  return state.netCents;
}

function selectionBank(families,seeds,priors) {
  const previous=lastslotReferences(priors),refs={...previous,lastslot:previous.rl},data=[];
  for(const {family,group} of families) {
    if(group===3) continue; // This ending has no selection objective.
    for(const seed of seeds) {
      const config={family,seed,priceCents:0},state=createLoadchoice(config);
      let o=observeLoadchoice(state),reading;
      const twoSlot=[];
      while(!o.done) {
        if(o.phase==="freight" && (o.wave===5 || o.wave===6)) {
          // Tariff's freight head uses public offers, reading and capacity.
          // Derive the two-slot branch once with an unpurchased reading.
          twoSlot.push(refs.tariff({...o,slots:2,surveyAction:"skip",reading:null})==="accept");
          reading=o.reading;
        }
        o=stepLoadchoice(state,o.phase==="survey"?"buy":"pass");
      }
      const h=o.history;
      let bits=0;for(let w=0;w<5;w++) bits|=Number(h[w].high)<<w;
      const prices=[];
      const historical={};
      if(group===2) for(const name of [...strict,"rally","trust","drift","turns"]) historical[name]=reference(config,refs[name]);
      for(const cents of PRICE_CENTS) {
        if(group<2 && cents===0) continue;
        const priced={family,seed,priceCents:cents};
        const prefix=createLoadchoice(priced);
        let po=observeLoadchoice(prefix);
        while(po.phase!=="survey") po=stepLoadchoice(prefix,refs.tariff(po));
        const controls=group===2 ? {...historical} : {planner:reference(priced,refs.planner)};
        if(group===2) for(const name of ["lastslot","tariff","paid"]) controls[name]=reference(priced,refs[name]);
        prices.push({cents,gross:prefix.grossCents,slots:po.slots,controls});
      }
      data.push({group,key:boardKey(h[0].quote),gate:gateKey(Math.round(10*h[3].quote.highChance),bits),
        h6:h[5].high,h7:h[6].high,b7:Math.round(10*h[6].quote.highChance),reading,twoSlot,prices,
        offers:h.slice(5).map(row=>row.offer.net)});
    }
  }
  return data;
}

function suffix(tape,wait,slots,reading) {
  const [p6,p7,p8]=tape.offers,s=sixKey(reading,tape.h6),j=sevenKey(s,tape.b7,tape.h7);
  let sum=0;
  if(!slots) return 0;
  if(slots===2?tape.twoSlot[0]:p6>=wait[s]) {sum+=p6;slots--;}
  if(!slots) return 100*sum;
  if(slots===2?tape.twoSlot[1]:p7>=wait[SIX+j]) {sum+=p7;slots--;}
  return 100*(sum+(slots?p8:0));
}

function selectionScore(boards,data) {
  const sums=Array.from({length:3},()=>({rl:0,never:0})),counts=[0,0,0];
  for(const tape of data) {
    const {group}=tape,row=boards[tape.key][tape.gate],wait=waitValues(row);
    const blind=[0,suffix(tape,wait,1,-1),suffix(tape,wait,2,-1)],buy=suffix(tape,wait,1,tape.reading);
    for(const {slots,gross,cents,controls} of tape.prices) {
      const selected=slots===1 && row.delta-cents/100>1e-10;
      sums[group].rl+=gross+(selected?buy-cents:blind[slots]);
      sums[group].never+=gross+blind[slots];
      for(const [name,net] of Object.entries(controls)) sums[group][name]=(sums[group][name]??0)+net;
      counts[group]++;
    }
  }
  const means=sums.map((s,g)=>Object.fromEntries(Object.entries(s).map(([k,n])=>[k,n/(100*counts[g])])));
  const [hot,cold,recovery]=means;
  const slacks=[hot.rl-hot.never,hot.rl-hot.planner,cold.rl-cold.never,cold.rl-cold.planner,
    Math.min(...strict.map(k=>recovery.rl-recovery[k]),...withinOne.map(k=>1+recovery.rl-recovery[k]))];
  return {means,counts,slacks,minimum:Math.min(...slacks),average:slacks.reduce((a,b)=>a+b,0)/slacks.length};
}

export function fitLoadchoice(index,seed,priors) {
  const train=LOADCHOICE_SUITE.splits.train;
  if(!Number.isInteger(index) || index<0 || (index+1)*FIT_SPEC.blockSize>train.count) throw new RangeError("Unknown fit block.");
  const blockStart=train.start+index*FIT_SPEC.blockSize;
  const [seeds7,seeds6,seedsGate,seedsSelect]=splitSeeds(blockStart,seed);
  const {fit,selection:held}=trainingMarkets(train.families,LOADCHOICE_PATTERNS);
  const seven=collect(seeds7,fit),six=collect(seeds6,fit),gate=collect(seedsGate,fit);
  const selection=selectionBank(held,seedsSelect,priors),candidates=[];
  let winner,weights;
  for(const [profile,multipliers] of FIT_SPEC.profiles) {
    const train7=mix(seven.groups,multipliers),train6=mix(six.groups,multipliers),trainGate=mix(gate.groups,multipliers);
    for(const shrinkage of FIT_SPEC.shrinkage) {
      const boards=Object.fromEntries([...seven.supports].map(([key,prices])=>[key,fitBoard(train7,train6,trainGate,prices,shrinkage)]));
      const metric={profile,multipliers,shrinkage,opening:FIT_SPEC.opening,...selectionScore(boards,selection)};
      candidates.push(metric);
      if(!winner || metric.minimum>winner.minimum || (metric.minimum===winner.minimum && metric.average>winner.average)) {
        winner=metric;weights={profile,shrinkage,opening:FIT_SPEC.opening,boards};
      }
    }
  }
  const trainingCounts={trainingSeed:seed,blockStart,blockSize:FIT_SPEC.blockSize,
    sevenSeeds:seeds7.length,sixSeeds:seeds6.length,calibrationSeeds:seedsGate.length,selectionSeeds:seedsSelect.length,
    fitFamilies:fit.map(x=>x.family),selectionFamilies:held.filter(x=>x.group<3).map(x=>x.family),
    sevenShifts:fit.length*seeds7.length,sixShifts:fit.length*seeds6.length,calibrationShifts:fit.length*seedsGate.length,
    selectionShifts:selection.length,selectionPriceCases:winner.counts.reduce((a,b)=>a+b,0)};
  return {weights,trainingCounts,selection:{profile:winner.profile,shrinkage:winner.shrinkage,opening:FIT_SPEC.opening,
    candidates,slackNames:["hotVsNever","hotVsPlanner","coldVsNever","coldVsPlanner","recovery"]}};
}
