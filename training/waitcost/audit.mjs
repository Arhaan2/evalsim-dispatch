// A second implementation of the experiment's tape, observations, trajectory
// ledger and paired bootstrap. Treat the published policies as dispatchers
// and verify their actions against separately regenerated freight and readings.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { WAITCOST_PATTERNS, WAITCOST_SUITE, PRICE_CENTS } from "../../docs/lib/waitcost.js";
import { chooseWaitcost } from "../../docs/lib/waitcost-policy.js";
import { chooseLoadchoice } from "../../docs/lib/loadchoice-policy.js";
import { chooseLastslot } from "../../docs/lib/lastslot-policy.js";
import { tariffDecision } from "../../docs/lib/tariff-policy.js";
import { paidDecision, paidPlannerDecision } from "../../docs/lib/paid-policy.js";
import { chooseBooking } from "../../docs/lib/booking-policy.js";
import { chooseSurvey } from "../../docs/lib/survey-policy.js";
import { chooseRally } from "../../docs/lib/rally-policy.js";
import { chooseTrust } from "../../docs/lib/trust-policy.js";
import { chooseDrift } from "../../docs/lib/drift-policy.js";
import { chooseTurns } from "../../docs/lib/turns-policy.js";
import { stochasticPlanner } from "../../docs/lib/reserve.js";

function bytes(path) {
  return readFileSync(new URL("../../docs/data/"+path+".json",import.meta.url));
}
const json = path => JSON.parse(bytes(path));
const result = json("waitcost/results");
const desk = json("waitcost/desk");
const historical = ["loadchoice","lastslot","tariff","paid","booking","survey","rally","trust","closes","drift","turns"];
const weights = json("loadchoice/desk").weights;
for (const name of historical) assert.deepEqual(weights[name],json(name+"/results").checkpoint.weights);
const checkpoint = result.checkpoint.weights;
assert.deepEqual(desk.weights, {...weights,waitcost:checkpoint});
for (const key of ["banks","checks","examples","splits","suite","version","protocol","fingerprint"]) {
  assert.deepEqual(desk[key],result[key]);
}

// Decode both fixed checkpoints independently of their public feature encoders.
// The two unguarded controls retain exactly the new gate and old freight rule.
const encodedWaits=new WeakMap();
function decodeAction(o,mode) {
  if(o.phase==="survey" && o.slots!==1) return "skip";
  if(o.slots===0) return "pass";
  if(o.wave===7) return "accept";
  if(o.wave<5 || o.slots===2) return tariffDecision(o,weights.tariff).action;
  const history=o.history.slice(0,5),quote=history[0].quote,key=quote.low+"/"+quote.high;
  const signs=history.reduce((word,item,i)=>word+(Number(item.high)<<i),0);
  const cell=32*(Math.round(10*history[3].quote.highChance)-1)+signs;
  const learned=checkpoint.boards[key][cell];
  if(o.phase==="survey") {
    if(mode==="always" || mode==="unguardedAlways" || mode==="alwaysStopForced") return "buy";
    return mode!=="never" && learned.delta-o.priceCents/100>1e-10 ? "buy" : "skip";
  }
  const base=weights.loadchoice.boards[key][cell];
  if(!encodedWaits.has(base)) encodedWaits.set(base,Buffer.from(base.wait,"base64"));
  const bytes=encodedWaits.get(base);
  const high=i=>i===o.wave ? o.offer.net===o.quote.high : o.history[i].high;
  const index=reading=>{
    const six=2*(reading+1)+Number(high(5));
    return o.wave===5 ? six : 16+18*six+2*(Math.round(10*o.quote.highChance)-1)+Number(high(6));
  };
  const threshold=idx=>1000*o.offer.net>=bytes.readUInt16LE(2*idx);
  const i=index(o.reading??-1);
  if(threshold(i)) return "accept";
  if(o.reading===null || mode.startsWith("unguarded") || !threshold(index(-1))) return "pass";
  if(mode.startsWith("alwaysStop")) return "accept";
  const estimate=learned.guard[i];
  if(!estimate) return "pass";
  return estimate[0]-checkpoint.penalty*estimate[1]<=0 ? "accept":"pass";
}
const specialist=mode=>o=>{
  const action=decodeAction(o,mode);
  let publicAction;
  const unguarded=mode.startsWith("unguarded"),blanket=mode.startsWith("alwaysStop");
  if(!unguarded && !blanket) {
    publicAction=chooseWaitcost(o,checkpoint,weights,mode);
  } else if(o.phase==="survey") {
    const forced=["alwaysStopForced","unguardedAlways"].includes(mode);
    publicAction=chooseWaitcost(o,checkpoint,weights,forced?"always":"optional");
  } else {
    publicAction=chooseLoadchoice(o,weights.loadchoice,weights);
    if(blanket && o.slots===1 && o.reading!==null && publicAction==="pass") {
      publicAction=chooseLoadchoice({...o,reading:null},weights.loadchoice,weights);
    }
  }
  assert.equal(action,publicAction);
  return action;
};
const skip = policy => observation=>observation.phase==="survey" ? "skip" : policy(observation);
const policies = {
  rl:specialist("optional"), rlNever:specialist("never"),
  planner:o=>paidPlannerDecision(o,weights.paid).action, rlAlways:specialist("always"),
  loadchoice:o=>chooseLoadchoice(o,weights.loadchoice,weights),
  unguarded:specialist("unguarded"),unguardedAlways:specialist("unguardedAlways"),
  alwaysStop:specialist("alwaysStop"),alwaysStopForced:specialist("alwaysStopForced"),
  lastslot:o=>chooseLastslot(o,weights.lastslot,weights),
  tariff:o=>tariffDecision(o,weights.tariff).action, paid:o=>paidDecision(o,weights.paid).action,
  stochastic:skip(stochasticPlanner), booking:skip(o=>chooseBooking(o,weights.booking,weights)),
  survey:skip(o=>chooseSurvey(o,weights.survey)), rally:skip(o=>chooseRally(o,weights.rally)),
  trust:skip(o=>chooseTrust(o,weights.trust,weights)), drift:skip(o=>chooseDrift(o,weights.drift)),
  turns:skip(o=>chooseTurns(o,weights.turns)),
};
const keys = Object.keys(policies);
const matchedKeys = ["rl","rlNever","planner"];

const low = [[9,8,6,7,4,7,4,4],[8,9,7,6,7,4,4,4]];
const high = [[18,22,24,28,30,24,34,32],[22,18,28,24,24,30,32,34]];
const costs = [3,5,4,6,3,4,5,6];
const lanes = ["Canal Market","East Wharf","Ridge Arcade","Mill Exchange",
  "Park Stores","Inlet Market","Pier Exchange","Foundry Stores"];

function uniform(seed) {
  return () => {
    seed = (seed+0x6d2b79f5)>>>0;
    let t = Math.imul(seed^(seed>>>15),seed|1);
    t ^= t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/2**32;
  };
}
function quote(low,high,chance) {
  return {low,high,highChance:chance,mean:low+(high-low)*chance};
}
function regenerateTape(seed,family) {
  const draw=uniform(seed), sample=uniform(seed^0xa5c379bd);
  const layout=Number(draw()>=0.5), cold=draw()<0.5?0.1:0.2, hot=draw()<0.5?0.75:0.85;
  const rates=WAITCOST_PATTERNS[family].levels.map(level=>cold+(hot-cold)*level/4);
  let reading=0;
  for(let i=0;i<6;i++) if(sample()<rates[5]) reading++;
  const board=[], offers=[];
  let bulletin=draw()<0.5?0.4:0.5;
  for(let wave=0;wave<8;wave++) {
    if(wave===3 || wave===6) {
      const noise=(Math.floor(draw()*3)-1)/10;
      bulletin=Math.max(0.1,Math.min(0.9,Math.round((rates[wave-2]+noise)*10)/10));
    }
    const q=quote(low[layout][wave],high[layout][wave],bulletin);
    const net=draw()<rates[wave]?q.high:q.low;
    board.push(q);
    offers.push({lane:lanes[wave],net,cost:costs[wave],revenue:net+costs[wave]});
  }
  // Future supports are public; future prices and changes to the bulletin
  // stay hidden. The signed offer at wave six is hidden at the survey gate.
  const observations=offers.map((offer,wave)=>({
    wave,offer,quote:board[wave],horizon:8,capacity:2,done:false,
    history:offers.slice(0,wave).map((offer,i)=>({wave:i,offer,quote:board[i],high:offer.net===board[i].high})),
    forecast:board.slice(wave+1).map(q=>quote(q.low,q.high,board[wave].highChance)),
  }));
  return {observations,reading};
}

function run(tape,policy,priceCents,common=false) {
  let remaining=2, grossCents=0, feeCents=0, gateSlots, lastLoad=0, surveyAction=null, reading=null;
  for(const publicWave of tape.observations) {
    const observation={...publicWave,slots:remaining,priceCents,surveyFee:priceCents/100,
      phase:"freight",surveyAction,reading,grossCents,gross:grossCents/100,feeCents,
      feePaid:feeCents/100,netCents:grossCents-feeCents,net:(grossCents-feeCents)/100};
    if(publicWave.wave===5) {
      gateSlots=remaining;
      if(common && gateSlots!==1) return null;
      surveyAction=policy({...observation,phase:"survey",offer:null});
      assert.ok(surveyAction==="buy" || surveyAction==="skip");
      if(surveyAction==="buy") {reading=tape.reading;feeCents=priceCents;}
      Object.assign(observation,{surveyAction,reading,feeCents,feePaid:feeCents/100,
        netCents:grossCents-feeCents,net:(grossCents-feeCents)/100});
    }
    const decide=common && publicWave.wave<5 ? policies.tariff : policy;
    const action=decide(observation);
    if(action==="accept") {
      assert(remaining>0);
      remaining--;
      grossCents+=100*(publicWave.offer.revenue-publicWave.offer.cost);
      if(publicWave.wave>=5) lastLoad=publicWave.wave+1;
    } else assert.equal(action,"pass");
  }
  return {net:grossCents-feeCents,grossCents,bought:surveyAction==="buy",gateSlots,lastLoad};
}
function pack(outcomes) {
  const purchaseMask=outcomes.reduce((mask,x,i)=>mask|(Number(x.bought)<<i),0);
  return [purchaseMask,...outcomes.map(x=>x.net)];
}

function* summaryPaths(family,price,matched) {
  const {stratum,ending}=WAITCOST_PATTERNS[family];
  yield ["all"];
  if(price>0) {yield ["positive"];yield ["positiveByStratumEnding",stratum,ending];}
  if(matched) return;
  yield ["byFamily",family];yield ["byEnding",ending];yield ["byStratum",stratum];
  yield ["byStratumEnding",stratum,ending];yield ["byPrice",price,"all"];
  yield ["byPrice",price,"byStratumEnding",stratum,ending];
}
function addToGroups(groups,row,matched) {
  for(const path of summaryPaths(row.family,row.price,matched)) {
    const key=path.join("|");
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
}
const samples=new Map();
function bootstrapIndices(clusterCount) {
  if(samples.has(clusterCount)) return samples.get(clusterCount);
  if(samples.size>16) samples.clear();
  const indices=new Uint16Array(2000*clusterCount);
  let state=613;
  for(let k=0;k<indices.length;k++) {
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    indices[k]=Math.floor(state/2**32*clusterCount);
  }
  samples.set(clusterCount,indices);
  return indices;
}
function independentlySummarize(rows,controls) {
  let candidateNet=0,bought=0,fees=0,tapes=0,previous;
  const bySeed=new Map();
  for(const row of rows) {
    candidateNet+=row.scores[1];
    if(row.scores[0]&1) {bought++;fees+=row.price;}
    const tape=row.seed+"/"+row.family;
    if(tape!==previous) tapes++;
    previous=tape;
    if(!bySeed.has(row.seed)) bySeed.set(row.seed,[]);
    bySeed.get(row.seed).push(row);
  }
  const clusters=[...bySeed].sort(([a],[b])=>a-b).map(([,cells])=>cells);
  const seeds=clusters.length, n=rows.length, indices=bootstrapIndices(seeds);
  // Common-one-slot denominators vary with the seed. Resample the numerator
  // and the number of eligible shifts together on every bootstrap draw.
  const denom=new Int32Array(2000), counts=clusters.map(c=>c.length);
  for(let j=0;j<indices.length;j++) denom[Math.floor(j/seeds)]+=counts[indices[j]];
  const references={};
  for(const [i,name] of controls.entries()) {
    let total=0,purchased=0,charged=0,wins=0,ties=0;
    const sums=Int32Array.from(clusters,cluster=>{
      let sum=0;
      for(const row of cluster) {
        const ref=row.scores[1+i],diff=row.scores[1]-ref;
        total+=ref;sum+=diff;
        wins+=Number(diff>0);ties+=Number(diff===0);
        if(row.scores[0]&(1<<i)) {purchased++;charged+=row.price;}
      }
      return sum;
    });
    const draws=new Float64Array(2000);
    if(sums.some(sum=>sum!==0)) {
      for(let b=0;b<draws.length;b++) {
        let sum=0;
        for(let j=b*seeds;j<(b+1)*seeds;j++) sum+=sums[indices[j]];
        draws[b]=sum/denom[b]/100;
      }
      draws.sort();
    }
    references[name]={mean:total/(100*n),delta:(candidateNet-total)/n/100,interval95:[draws[50],draws[1949]],
      wins,ties,losses:n-wins-ties,bought:purchased,fees:charged/100};
  }
  return {shifts:n,tapes,seeds,mean:candidateNet/(100*n),bought,fees:fees/100,references};
}

const loadCounters=()=>({runs:0,changed:0,higher:0,lower:0,equal:0,grossDeltaCents:0,
  wait:{unguardedLater:0,unguardedHarmful:0,unguardedBeneficial:0,guardedLater:0,guardedHarmful:0,
    guardedBeneficial:0,interventions:0,saved:0,costly:0,tied:0,guardGainCents:0,
    opportunitiesToStop:0,worthwhileStops:0,missedSavings:0,unnecessaryStops:0,blanketGainCents:0}});
const counters=()=>({shifts:0,oneSlot:0,bought:0,feeCents:0,buyGainCents:0,
  forced:loadCounters(),purchases:loadCounters()});
function addOutcome(bucket,optional,blind,always,unguarded,blanket,price) {
  bucket.shifts++;
  bucket.buyGainCents+=optional.net-blind.net;
  if(optional.gateSlots!==1) {
    assert.equal(optional.bought,false);
    return;
  }
  bucket.oneSlot++;
  if(optional.bought) {bucket.bought++;bucket.feeCents+=price;}
  const grossDelta=always.grossCents-blind.grossCents;
  const changed=always.lastLoad!==blind.lastLoad;
  if(!changed) assert.equal(grossDelta,0);
  for(const data of optional.bought?[bucket.forced,bucket.purchases]:[bucket.forced]) {
    data.runs++; data.grossDeltaCents+=grossDelta;
    const timing=data.wait, guardReturn=always.grossCents-unguarded.grossCents;
    const opportunity = blanket.lastLoad!==unguarded.lastLoad;
    const alternative = blanket.grossCents-unguarded.grossCents;
    timing.guardGainCents+=guardReturn;
    timing.blanketGainCents+=alternative;
    if(opportunity) {
      timing.opportunitiesToStop++;
      if(alternative>0) {
        timing.worthwhileStops++;
        if(always.lastLoad===unguarded.lastLoad) timing.missedSavings++;
      }
    } else assert.equal(alternative,0);
    if(always.lastLoad!==unguarded.lastLoad && guardReturn<=0) timing.unnecessaryStops++;

    if(always.lastLoad!==unguarded.lastLoad) {
      assert((always.lastLoad||9)<(unguarded.lastLoad||9));
      timing.interventions++;
      if(guardReturn>0) timing.saved++;
      else if(guardReturn<0) timing.costly++;
      else timing.tied++;
    } else assert.equal(guardReturn,0);
    for(const [name,action] of [["guarded",always],["unguarded",unguarded]]) {
      if((action.lastLoad||9)>(blind.lastLoad||9)) {
        timing[name+"Later"]++;
        if(action.grossCents<blind.grossCents) timing[name+"Harmful"]++;
        if(action.grossCents>blind.grossCents) timing[name+"Beneficial"]++;
      }
    }
    if(changed) {
      data.changed++;
      if(grossDelta>0) data.higher++;
      else if(grossDelta<0) data.lower++;
      else data.equal++;
    }
  }
}

function checkSplit(split,outcome) {
  const {start,count,families}=WAITCOST_SUITE.splits[split], raw=bytes("waitcost/"+split);
  assert.equal(createHash("sha256").update(raw).digest("hex"),result.banks[split]);
  const bank=JSON.parse(raw);
  assert.deepEqual(bank.keys,keys);
  assert.equal(bank.split,split);
  assert.equal(bank.suite,WAITCOST_SUITE.id);
  const groups=new Map(), gateGroups=new Map(), opportunities={};
  let cases=0,matches=0,intervals=0;
  for(let seed=start;seed<start+count;seed++) for(const family of families) {
    const tape=regenerateTape(seed,family);
    const {stratum,ending}=WAITCOST_PATTERNS[family];
    for(const price of PRICE_CENTS) {
      const rows=keys.map(key=>run(tape,policies[key],price));
      const [optional,blind,,always,,unguardedOptional,unguarded,blanketOptional,blanket]=rows;
      assert.equal(blanketOptional.bought,optional.bought);
      assert.equal(blanketOptional.net,optional.bought?blanket.net:blind.net);
      assert.equal(unguardedOptional.bought,optional.bought);
      assert.equal(unguardedOptional.net,optional.bought?unguarded.net:blind.net);
      const scores=pack(rows);
      assert.deepEqual(scores,bank.scores[cases],split+" ledger "+cases);
      assert.equal(optional.gateSlots,bank.slots[cases]);
      assert.equal(blind.bought,false);
      assert.equal(optional.net,optional.bought?always.net:blind.net);
      const loads=optional.gateSlots===1 ? [always.lastLoad,blind.lastLoad,unguarded.lastLoad,blanket.lastLoad] : null;
      assert.deepEqual(loads,bank.loads[cases],split+" final bookings "+cases);
      const row={seed,family,price,scores};
      addToGroups(groups,row,false);
      for(const name of ["all",stratum+"/"+ending]) {
        const group=opportunities[name]??={all:counters(),positive:counters(),byPrice:{}};
        addOutcome(group.all,optional,blind,always,unguarded,blanket,price);
        if(price>0) addOutcome(group.positive,optional,blind,always,unguarded,blanket,price);
        addOutcome(group.byPrice[price]??=counters(),optional,blind,always,unguarded,blanket,price);
      }

      const matched=matchedKeys.map(key=>run(tape,policies[key],price,true));
      if(matched[0]) {
        assert(matched.every(x=>x.gateSlots===1));
        const controlled=pack(matched);
        assert.deepEqual(controlled,bank.matched[cases],split+" matched ledger "+cases);
        addToGroups(gateGroups,{...row,scores:controlled},true);
        matches++;
      } else {
        assert(matched.every(x=>x===null));assert.equal(bank.matched[cases],null);
      }
      cases++;
    }
  }
  for(const column of ["scores","loads","slots","matched"]) assert.equal(bank[column].length,cases);
  assert.deepEqual(opportunities,outcome.opportunities);
  for(const [collection,target,controls] of [[groups,outcome.summary,keys],[gateGroups,outcome.matched,matchedKeys]]) {
    for(const [path,rows] of collection) {
      const recorded=path.split("|").reduce((node,key)=>node[key],target);
      assert.deepEqual(independentlySummarize(rows,controls),recorded,split+" "+path);
      intervals+=controls.length;
    }
  }
  console.log(split+" verified "+cases+" priced cases and "+matches+" common one-slot cases.");
  return {cases,matches,intervals};
}

const totals={tapes:0,cases:0,matches:0,intervals:0};
for(const split of ["validation","test","retention","archive"]) {
  const counts=checkSplit(split,result.splits[split]);
  totals.tapes+=counts.cases/PRICE_CENTS.length;
  for(const [key,value] of Object.entries(counts)) totals[key]+=value;
}
// The website's worked examples report both counterfactuals on one tape.
for(const example of result.examples) {
  const tape=regenerateTape(example.seed,example.family);
  const observed=run(tape,policies.rl,example.priceCents);
  const blind=run(tape,policies.rlNever,example.priceCents);
  const informed=run(tape,policies.rlAlways,example.priceCents);
  const unguarded=run(tape,policies.unguardedAlways,example.priceCents);
  assert.equal(unguarded.lastLoad,example.unguardedWave);
  assert.equal(informed.grossCents-unguarded.grossCents,example.guardGainCents);
  assert.equal(observed.gateSlots,1);
  assert.equal(observed.bought,example.bought);
  assert.equal(informed.lastLoad,example.buyWave);assert.equal(blind.lastLoad,example.skipWave);
  assert.equal(informed.net-blind.net,example.deltaCents);
  assert.equal(informed.grossCents-blind.grossCents,example.grossDeltaCents);
}
const gates=result.splits.test.summary.positiveByStratumEnding;
const positiveVsBoth=g=>["rlNever","planner"].every(k=>g.references[k].interval95[0]>0);
const original=result.splits.retention.summary.all.references;
const originalDrop=["stochastic","booking","survey"].every(k=>original[k].interval95[0]>0) &&
  ["loadchoice","lastslot","tariff","paid","rally","trust","drift","turns"].every(k=>original[k].interval95[0]>-1);
const hotDrops=gates["interrupted-drop"].hot.references.planner.interval95[0]>0,coldReversals=positiveVsBoth(gates.reversal.cold);
assert.deepEqual(result.checks,{hotDrops,coldReversals,originalDrop,joint:hotDrops&&coldReversals&&originalDrop});
console.log("Verified "+totals.tapes+" regenerated tapes, "+totals.cases*keys.length+" full-shift scores, "+
  totals.matches*matchedKeys.length+" matched scores, final booking waves and "+totals.intervals+" intervals.");
