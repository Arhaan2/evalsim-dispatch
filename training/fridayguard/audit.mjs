// Recalculate each dispatch and ledger on its own positions, on independently
// reconstructed public menus. Pair whole weeks and verify the individual Friday loads.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {closureFrames} from "../../docs/lib/closure-world.js";
import {closureFrame,chooseClosurePlanner} from "../../docs/lib/closure-planner.js";
import {makeSwitchCostPolicy} from "../../docs/lib/switchcost-policy.js";
import {makePrepositionPolicy} from "../../docs/lib/preposition-policy.js";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {fridayGuardProposal,decideFridayGuard,guardEstimates} from "../../docs/lib/fridayguard-policy.js";
import {loadFridayGuardBank} from "../../docs/lib/fridayguard-study.js";
import {average,paired,publicFrames,replay} from "../fleetweek/audit-helpers.mjs";
import {checkNotices,openMoves} from "../fleetweek/audit-closures.mjs";
import {verifyScores} from "../fleetweek/verify-split.mjs";
import {hash} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data} from "./checkpoints.mjs";

const fresh=["friday-relay","friday-ramp","friday-pivot","friday-return","friday-weave","friday-exchange","friday-transfer","friday-loop"];
const manifests=[
  ["validation",["friday-crossing","friday-spur"],128,1450000000,[2,4,6],[1,2,3,4,5]],
  ["test",fresh,4096,1460000000,[3,5,7],[1,2,3,4,4,4,5,5,5]],
  ["clean",fresh,512,1470000000,null,null],["archive",["double-return"],4096,1480000000,null,null],
];
const refs=["rl","previous","fit211","frozen73","planner"];
const report=JSON.parse(await readFile(new URL("results.json",data)));
const {weights,hashes,fits}=await checkpoints();
assert.equal(report.suite,"dispatch-fridayguard-v1");
assert.equal(report.primarySeed,73);assert.deepEqual(report.fitSeeds,[73,101,211]);
assert.deepEqual(report.weightHashes,Object.fromEntries(fits.map(f=>[f.seed,f.sha])));
for(const [k,v] of Object.entries(hashes))assert.equal(report[k],v);
const noHeads=fits.map(({model})=>({...model,heads:Object.fromEntries(["friday","service","net"].map(k=>[k,{bias:0,trees:[]}]))}));
const incumbent=makePrepositionPolicy(weights.preposition101,weights),fit211=makePrepositionPolicy(weights.preposition211,weights);
const parent=makeSwitchCostPolicy(weights.parent,weights);
async function reader(file,digest){const bytes=await readFile(new URL(file,data));assert.equal(hash(bytes),digest,file);return JSON.parse(bytes);}

function auditCase(c,config) {
  const frames=closureFrames(config),underlying=publicFrames(config);
  checkNotices(frames,underlying,config.closure);
  const w=frames.findIndex(o=>o.incident.status==="warning");
  assert.equal(c.warningEpoch,w<0?null:w);
  assert.equal(c.duration,frames.filter(o=>o.incident.status==="closed").length);
  assert.equal(c.closedAtEnd,frames.at(-1).incident.status==="closed");
  const cache=new Map();
  function board(obs,all){
    const key=9*obs.epoch+3*obs.positions[0]+obs.positions[1];
    if(!cache.has(key)){
      const legal=openMoves(obs,all),p=fridayGuardProposal(closureFrame(obs),legal,weights);
      const ids={previous:incumbent(obs,legal),fit211:fit211(obs,legal),frozen73:parent(obs,legal),planner:chooseClosurePlanner(obs,legal)};
      assert.equal(p.warning,obs.epoch===w);assert.equal(p.defaultId,ids.previous);
      assert.equal(p.fit101Id,ids.previous);assert.equal(p.fit211Id,ids.fit211);
      assert.equal(p.parentId,ids.frozen73);assert.equal(p.plannerId,ids.planner);
      const candidates=[...new Set([ids.fit211,ids.frozen73])].filter(id=>id!==ids.previous);
      assert.deepEqual(p.choices.map(v=>v.id),candidates);
      if(obs.epoch!==w)assert.equal(candidates.length,0);
      for(const [i,{model}] of fits.entries()) {
        const {alwaysDefault,hurdle,serviceWeight,netWeight}=model.settings;
        const estimates=guardEstimates(p.choices,model.heads);
        const values=estimates.map(v=>v.friday+serviceWeight*v.service+netWeight*v.net/34);
        const best=Math.max(...values);
        const selected=alwaysDefault||best<=hurdle?ids.previous:estimates[values.indexOf(best)].id;
        assert.equal(decideFridayGuard(p,model),selected);
        assert.equal(decideFridayGuard(p,noHeads[i]),ids.previous);
        ids["model"+i]=selected;
      }
      cache.set(key,{ids,legal});
    }
    return cache.get(key);
  }
  function run(k,record) {
    const actions=[];
    const ledger=replay(frames,(obs,all)=>{
      const {ids,legal}=board(obs,all),id=ids[k];assert(legal.some(a=>a.id===id));actions.push(id);return id;
    },record);
    return {actions,ledger};
  }
  for(const k of refs.slice(1))run(k,c[k]);
  const paths=fits.map((_,i)=>run("model"+i,i===0?c.rl:undefined));
  for(const path of [...paths,c.fit211,c.frozen73]) {
    assert.deepEqual(path.actions.slice(0,w<0?10:w),c.previous.actions.slice(0,w<0?10:w));
    if(w<0||path.actions[w]===c.previous.actions[w])assert.deepEqual(path,c.previous);
  }
  if(w<0)replay(underlying,chooseFleetPlanner,c.planner);
  return paths;
}
const signed=id=>/^C\||\|C$/.test(id);
function fridayFlags(actions){return actions.slice(8).map(signed);}
function scoringRows(cases,paths) {
  return cases.map((c,i)=>{
    const policies={agent:paths[i],...Object.fromEntries(refs.map(k=>[k,c[k]]))};
    return {family:c.family,fridays:Object.fromEntries(Object.entries(policies).map(([k,p])=>[k,fridayFlags(p.actions)])),
      ...Object.fromEntries(Object.entries(policies).map(([k,p])=>[k,p.ledger]))};
  });
}
function checkStatistics(rows,stats) {
  const fridays=rows.map(r=>({family:r.family,...Object.fromEntries(Object.entries(r.fridays).map(([k,f])=>
    [k,{net:f.filter(Boolean).length,served:0}]))}));
  assert.equal(stats.friday.agentTotal,fridays.reduce((s,r)=>s+r.agent.net,0));
  for(const k of refs){
    const weekly=paired(rows,k);assert.deepEqual(stats.comparisons[k],weekly);
    const netCredits=rows.reduce((s,r)=>s+r.agent.net-r[k].net,0);
    const netDeliveries=rows.reduce((s,r)=>s+r.agent.served-r[k].served,0);
    assert.deepEqual(stats.weeklyTotals[k],{netCredits,netDeliveries,deliveriesPerWeek:netDeliveries/rows.length,
      deliveriesPerWeek95:weekly.service95.map(v=>v/10)});
    let saved=0,lost=0;
    for(const {fridays:d} of rows)for(const i of [0,1]){
      if(d.agent[i]&&!d[k][i])saved++;if(d[k][i]&&!d.agent[i])lost++;
    }
    const delta=paired(fridays,k);
    assert.deepEqual(stats.friday.comparisons[k],{saved,lost,net:saved-lost,perWeek:delta.net,perWeek95:delta.net95});
  }
  const {fit211}=stats.friday.comparisons,{planner,frozen73,previous}=stats.comparisons;
  const goals={fridayFit211:fit211.perWeek95[0]>0,profitPlanner:planner.net95[0]>0,
    deliveriesFrozen73:frozen73.service95[0]>0,profitFrozen73:frozen73.net95[0]>0,
    retainDeliveries101:previous.service95[0]>=0,retainProfit101:previous.net95[0]>=0};
  assert.deepEqual(stats.goals,{...goals,joint:Object.values(goals).every(Boolean)});
}
function auditEvidence(cases,paths,stats) {
  // Enumerate all eight combinations of parent, incumbent, candidate on the exact same Friday board.
  const histogram=Array(8).fill(0),first={};
  const fallback={fit211Only:0,frozen73Only:0,bothAlternatives:0};
  let warnings=0,changedWarnings=0;
  for(const [i,c] of cases.entries()) {
    const candidate=paths[i],w=c.warningEpoch;
    if(w!==null) {
      warnings++;
      if(candidate.actions[w]!==c.previous.actions[w]){
        changedWarnings++;
        const is211=candidate.actions[w]===c.fit211.actions[w],is73=candidate.actions[w]===c.frozen73.actions[w];
        assert(is211||is73);fallback[is211?(is73?"bothAlternatives":"fit211Only"):"frozen73Only"]++;
      }
    }
    for(const epoch of [8,9]){
      const code=[c.frozen73,c.previous,candidate].reduce((value,path)=>2*value+Number(signed(path.actions[epoch])),0);
      histogram[code]++;
      if(!first[code])first[code]={family:c.family,seed:c.seed,closure:c.closure,warningEpoch:w,epoch,
        candidate,previous:c.previous,frozen73:c.frozen73};
    }
  }
  const [,newGains,surrendered,kept,remaining,prevented,introduced]=histogram;
  assert.deepEqual(stats.lossAccounting,{losses101:remaining+prevented,prevented,remaining,introduced,
    gains101:surrendered+kept,kept,surrendered,newGains});
  assert.deepEqual(stats.decisions,{warnings,changedWarnings,...fallback});
  assert.deepEqual(stats.examples,{prevented:first[5]??null,introduced:first[6]??null,
    surrendered:first[2]??null,newGain:first[1]??null});
}
for(const [split,families,count,first,starts,durations] of manifests) {
  const {cases}=await loadFridayGuardBank(split,reader,report.banks[split]);
  const s=report.splits[split],paths=fits.map(()=>[]);
  for(const [i,c] of cases.entries()) {
    const j=Math.floor(i/count),config={family:families[j],seed:first+10000*j+i%count,closure:starts?{starts,durations}:null};
    for(const [key,value] of Object.entries(config))assert.deepEqual(c[key],value);
    for(const [m,path] of auditCase(c,config).entries())paths[m].push(path);
  }
  assert.equal(s.closedAtEnd,cases.filter(c=>c.closedAtEnd).length);
  for(const [i,f] of fits.entries()) {
    const rows=scoringRows(cases,paths[i]),stats=s.fits[i],av=average(rows,"agent");
    assert.equal(stats.seed,f.seed);assert.equal(stats.net,av.net);assert.equal(stats.onTime,av.onTime);
    checkStatistics(rows,stats);auditEvidence(cases,paths[i],stats);
    if(i===0){
      const checkSection=(group,section)=>{
        verifyScores(group,section,refs);
        checkStatistics(group,section);
      };
      checkSection(rows,s.summary.all);
      for(const family of families)checkSection(rows.filter(r=>r.family===family),s.summary.byFamily[family]);
    }
  }
  console.log("Audited",split,cases.length,"weeks,",7*cases.length,"policy paths, all signed Friday loads, zero heads and six goals.");
}
assert.deepEqual(report.goals,report.splits.test.fits[0].goals);
