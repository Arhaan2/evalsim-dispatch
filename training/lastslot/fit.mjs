import { createLastslot, observeLastslot, stepLastslot, LASTSLOT_PATTERNS, LASTSLOT_SUITE, PRICE_CENTS } from "../../docs/lib/lastslot.js";
import { boardKey, gateKey, sixKey, sevenKey, packWait, waitValues } from "../../docs/lib/lastslot-policy.js";
import { trainingMarkets } from "../../docs/lib/paid-policy.js";
import { tariffReferences } from "../../docs/lib/tariff-benchmark.js";
import { prng } from "../protocol.mjs";

export const FIT_SPEC=Object.freeze({
  blockSize:12000, tailSeeds:2000, calibrationSeeds:2000, selectionSeeds:1000, shrinkage:48,
  profiles:[["equal",[1,1,1,1]],["hot-cold",[4,4,1,1]],["all-targets",[4,4,4,1]],["recovery",[1,1,4,1]]],
  openings:["tariff","planner"],
});
const historical=["stochastic","booking","survey","rally","trust","drift","turns"];
const references=["planner","tariff","paid",...historical];
const rounded=n=>Math.round(n*1e6)/1e6;
const support=q=>[q.low,q.high];
const cells=288;
const width=2*cells;
const choose6=[1,6,15,20,15,6,1];

function banks(seed,start) {
  const {blockSize,tailSeeds,calibrationSeeds,selectionSeeds}=FIT_SPEC,draw=prng(seed);
  const values=Array.from({length:blockSize},(_,i)=>start+i);
  const middle=tailSeeds+calibrationSeeds, end=middle+selectionSeeds;
  for(let i=0;i<end;i++) {
    const j=i+Math.floor(draw()*(blockSize-i));
    [values[i],values[j]]=[values[j],values[i]];
  }
  return [values.slice(0,tailSeeds),values.slice(tailSeeds,middle),values.slice(middle,end)];
}

// Integrate the joint transition and final reward mass for a TRAIN-only suffix.
// r=-1 marginalizes the survey; r=0..6 represents each observable sample.
export function suffixLaw([p5,p6,p7,p8]) {
  const v=new Float64Array(width);
  for(let r=-1;r<=6;r++) for(let h6=0;h6<=1;h6++) {
    const read=r<0 ? 1 : choose6[r]*p6**r*(1-p6)**(6-r);
    const before=read*(h6?p6:1-p6)/3;
    for(const noise of [-0.1,0,0.1]) for(let h7=0;h7<=1;h7++) {
      const b=Math.min(9,Math.max(1,Math.round(10*(p5+noise))));
      const at=sevenKey(sixKey(r,h6),b,h7),mass=before*(h7?p7:1-p7);
      v[at]+=mass;
      v[cells+at]+=mass*p8;
    }
  }
  return v;
}

function signedPrefix(state) {
  let bits=0;
  for(let w=0;w<5;w++) if(state.offers[w].net===state.board[w].high) bits|=1<<w;
  return gateKey(Math.round(10*state.board[3].highChance),bits);
}

function collectLaw(seeds,markets) {
  const scenarios=new Map(),boards=new Map(), laws=[];
  for(const {family,group} of markets) for(const seed of seeds) {
    const state=createLastslot({family,seed,priceCents:0}), key=boardKey(state.board[0]);
    if(!boards.has(key)) boards.set(key,{
      prices:state.board.slice(5).map(support),
      counts:Array.from({length:cells},()=>new Map()),
    });
    const rates=state.trueHighChances.slice(4),signature=rates.join("/");
    if(!scenarios.has(signature)) {
      scenarios.set(signature,laws.length);
      laws.push(suffixLaw(rates));
    }
    const bucket=4*scenarios.get(signature)+group;
    const counts=boards.get(key).counts[signedPrefix(state)];
    counts.set(bucket,(counts.get(bucket)??0)+1);
  }
  return {boards,laws};
}

function accumulate(to,from,scale=1) {
  for(let i=0;i<to.length;i++) to[i]+=scale*from[i];
}
function normalize(v) {
  let mass=0;
  for(let k=0;k<18*2;k++) mass+=v[k]; // two blind wave-six offer branches
  for(let i=0;i<v.length;i++) v[i]/=mass;
  return v;
}

function posteriors(source,key,weights) {
  const {counts}=source.boards.get(key), total=new Float64Array(width);
  const coarse=Array.from({length:36},()=>new Float64Array(width));
  // Share evidence by the exact first bulletin and signed waves two and three.
  const parent=i=>4*Math.floor(i/32)+((i>>1)&3);
  const rows=counts.map((counts,i)=>{
    const row=new Float64Array(width);
    for(const [bucket,count] of counts) accumulate(row,source.laws[Math.floor(bucket/4)],weights[bucket%4]*count);
    accumulate(total,row);
    accumulate(coarse[parent(i)],row);
    return row;
  });
  normalize(total);
  for(const row of coarse) { accumulate(row,total,FIT_SPEC.shrinkage); normalize(row); }
  for(const [i,row] of rows.entries()) { accumulate(row,coarse[parent(i)],FIT_SPEC.shrinkage); normalize(row); }
  return rows;
}

// One remaining booking: at seven, compare the offer to E[final offer | branch].
// At six the wait reward is the seven/eight optimal stopping return. Roll the
// deployed, rounded thresholds through calibration so action ties agree exactly.
export function fitContinuation(law,prices) {
  const [,p7,p8]=prices,values=new Float64Array(16+cells);
  let fallback=0;
  for(let j=0;j<36;j++) fallback+=law[cells+j];
  for(let six=0;six<16;six++) {
    let future=0,mass6=0;
    for(let j=six*18;j<(six+1)*18;j++) {
      const mass=law[j],final=p8[0]+(p8[1]-p8[0])*(mass ? law[cells+j]/mass : fallback);
      values[16+j]=Math.round(1000*final)/1000;
      future+=mass*(p7[j%2]>=values[16+j]-1e-10 ? p7[j%2] : final);
      mass6+=mass;
    }
    values[six]=mass6 ? future/mass6 : p8[0]+(p8[1]-p8[0])*fallback;
  }
  return {wait:packWait(values)};
}

// The two continuations share the same hidden shift, prices, final demand
// and bulletin. Only the visible reading changes. Subtract within each branch.
export function calibratePaired(law,prices,row) {
  const waits=waitValues(row),[p6,p7,p8]=prices;
  let skip=0,delta=0;
  for(let j=36;j<cells;j++) {
    const mass=law[j];
    if(!mass) continue;
    const six=Math.floor(j/18),h6=six%2,h7=j%2;
    const final=p8[0]*mass+(p8[1]-p8[0])*law[cells+j];
    const credit=(s,k)=>p6[h6]>=waits[s]-1e-10 ? p6[h6]*mass :
      p7[h7]>=waits[16+k]-1e-10 ? p7[h7]*mass : final;
    const blind=credit(h6,j%36);
    skip+=blind;
    delta+=credit(six,j)-blind;
  }
  row.skip=rounded(skip);
  row.delta=rounded(delta);
  return row;
}

function fitBoards(freight,calibration,weights) {
  const boards={};
  for(const [key,{prices}] of freight.boards) {
    const learns=posteriors(freight,key,weights), paired=posteriors(calibration,key,weights);
    boards[key]=learns.map((law,i)=>calibratePaired(paired[i],prices,fitContinuation(law,prices)));
  }
  return boards;
}

function selectionBank(seeds,markets,priors) {
  const ref=tariffReferences(priors);
  const names={...ref,tariff:ref.rl};
  const controls=[
    ...PRICE_CENTS.flatMap((cents,price)=>["tariff","planner","paid"].map(name=>({cents,price,name,choose:names[name]}))),
    ...historical.map(name=>({name,price:0,cents:0,choose:names[name]})),
  ];
  const data=[];
  for(const {family,group} of markets) for(const seed of seeds) {
    const state=createLastslot({family,seed,priceCents:0});
    const offers=state.offers.slice(5).map(o=>o.net);
    const row={group,key:boardKey(state.board[0]),cell:signedPrefix(state),offers,
      h6:offers[0]===state.board[5].high,h7:offers[1]===state.board[6].high,
      b:Math.round(10*state.board[6].highChance),reading:null,
      openings:{tariff:[],planner:[]},twoSlot:{tariff:[],planner:[]},
      net:Object.fromEntries(references.map(name=>[name,[]]))};
    const slots=controls.map(()=>2),nets=controls.map(()=>0),buys=controls.map(()=>false);
    let o=observeLastslot(state);
    while(!o.done) {
      if(o.phase==="freight" && (o.wave===5 || o.wave===6)) {
        // Both published opening policies ignore sunk fees for these freight
        // decisions. Their two-slot blind actions are shared across prices.
        const blind={...o,slots:2,surveyAction:"skip",reading:null};
        for(const name of FIT_SPEC.openings) row.twoSlot[name].push(names[name](blind)==="accept");
        if(o.wave===5) row.reading=o.reading;
      }
      for(const [j,control] of controls.entries()) {
        const {name,price,cents,choose}=control;
        if(o.phase==="survey" && name in row.openings) row.openings[name][price]={slots:slots[j],gross:nets[j]};
        if(!slots[j]) continue;
        const feeCents=buys[j]?cents:0,netCents=nets[j];
        const obs={...o,slots:slots[j],priceCents:cents,surveyFee:cents/100,feeCents,netCents,
          grossCents:netCents+feeCents,feePaid:feeCents/100,gross:(netCents+feeCents)/100,net:netCents/100,
          reading:buys[j]?o.reading:null,surveyAction:o.wave<5 || o.phase==="survey" ? null : buys[j]?"buy":"skip"};
        const action=choose(obs);
        if(action==="buy") {buys[j]=true; nets[j]-=cents;}
        if(action==="accept") {slots[j]--; nets[j]+=100*o.offer.net;}
      }
      o=stepLastslot(state,o.phase==="survey"?"buy":"pass");
    }
    for(const [j,{name,price}] of controls.entries()) {
      if(historical.includes(name)) row.net[name]=PRICE_CENTS.map(()=>nets[j]);
      else row.net[name][price]=nets[j];
    }
    data.push(row);
  }
  return data;
}

function suffixNet(tape,row,opening,slots,reading) {
  if(!slots) return 0;
  const choices=tape.twoSlot[opening],wait=waitValues(row),[p6,p7,p8]=tape.offers;
  const six=sixKey(reading,tape.h6),seven=sevenKey(six,tape.b,tape.h7);
  const chooseSix=slots===2 ? choices[0] : p6>=wait[six]-1e-10;
  let total=0;
  if(chooseSix) {total+=p6; slots--;}
  if(!slots) return 100*total;
  const chooseSeven=slots===2 ? choices[1] : p7>=wait[16+seven]-1e-10;
  if(chooseSeven) {total+=p7; slots--;}
  return 100*(total+(slots?p8:0));
}

const strictRecovery=["stochastic","booking","survey"];
const retained=["tariff","paid","rally","trust","drift","turns"];
function score(boards,opening,data) {
  const sums=Array.from({length:3},()=>Object.fromEntries(["rl","never",...references].map(n=>[n,0])));
  const counts=[0,0,0];
  for(const tape of data) {
    const g=tape.group;
    if(g>2) continue;
    const row=boards[tape.key][tape.cell],prefix=tape.openings[opening];
    const blind=[0,suffixNet(tape,row,opening,1,-1),suffixNet(tape,row,opening,2,-1)];
    const informed=suffixNet(tape,row,opening,1,tape.reading);
    for(const [p,cents] of PRICE_CENTS.entries()) {
      if(g<2 && !cents) continue;
      const {slots,gross}=prefix[p],bought=slots===1 && row.delta-cents/100>1e-10;
      sums[g].rl+=gross+(bought?informed-cents:blind[slots]);
      sums[g].never+=gross+blind[slots];
      for(const name of references) sums[g][name]+=tape.net[name][p];
      counts[g]++;
    }
  }
  const means=sums.map((group,g)=>Object.fromEntries(Object.entries(group).map(([k,v])=>[k,v/(counts[g]*100)])));
  const [hot,cold,recovery]=means;
  const slacks=[hot.rl-hot.never,hot.rl-hot.planner,cold.rl-cold.never,cold.rl-cold.planner,
    Math.min(...strictRecovery.map(name=>recovery.rl-recovery[name]),...retained.map(name=>recovery.rl-recovery[name]+1))];
  return {opening,means,counts,slacks,minimum:Math.min(...slacks),average:slacks.reduce((a,b)=>a+b)/slacks.length};
}

export function fitLastslot(index,seed,priors) {
  const train=LASTSLOT_SUITE.splits.train;
  if(!Number.isInteger(index) || index<0 || (index+1)*FIT_SPEC.blockSize>train.count) throw new RangeError("Unknown fit block.");
  const blockStart=train.start+index*FIT_SPEC.blockSize;
  const [freightSeeds,calibrationSeeds,selectionSeeds]=banks(seed,blockStart);
  const {fit,selection:held}=trainingMarkets(train.families,LASTSLOT_PATTERNS);
  const freight=collectLaw(freightSeeds,fit),calibration=collectLaw(calibrationSeeds,fit);
  const data=selectionBank(selectionSeeds,held,priors),candidates=[];
  let weights,winner;
  for(const [profile,multipliers] of FIT_SPEC.profiles) {
    const boards=fitBoards(freight,calibration,multipliers);
    for(const opening of FIT_SPEC.openings) {
      const metric={profile,multipliers,...score(boards,opening,data)};
      candidates.push(metric);
      if(!winner || metric.minimum>winner.minimum || (metric.minimum===winner.minimum && metric.average>winner.average)) {
        weights={profile,opening,boards}; winner=metric;
      }
    }
  }
  return {weights,trainingCounts:{trainingSeed:seed,blockStart,blockSize:FIT_SPEC.blockSize,tailSeeds:freightSeeds.length,
    calibrationSeeds:calibrationSeeds.length,selectionSeeds:selectionSeeds.length,fitFamilies:fit.map(x=>x.family),
    selectionFamilies:held.map(x=>x.family),tailShifts:fit.length*freightSeeds.length,
    calibrationShifts:fit.length*calibrationSeeds.length,selectionShifts:data.length,selectionPriceCases:data.length*PRICE_CENTS.length},
    selection:{profile:winner.profile,opening:winner.opening,candidates,slackNames:["hotVsNever","hotVsPlanner","coldVsNever","coldVsPlanner","recovery"],
      groups:["hotDropsPositivePrices","coldReversalsPositivePrices","recoveryAllPrices"]}};
}
