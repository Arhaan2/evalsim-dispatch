// Independently regenerate unobserved freight and repair notices, recompute each
// dispatcher on its own truck positions, and account for contracts and trip costs.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {closureFrames} from "../../docs/lib/closure-world.js";
import {chooseClosurePlanner,makeClosureFlatRisk,closureFrame} from "../../docs/lib/closure-planner.js";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {makeLongRepairPolicy} from "../../docs/lib/longrepair-policy.js";
import {makeSwitchCostPolicy} from "../../docs/lib/switchcost-policy.js";
import {prepositionProposal,predictMenus,decisionFromProposal} from "../../docs/lib/preposition-policy.js";
import {loadPrepositionBank} from "../../docs/lib/preposition-study.js";
import {paired,average,publicFrames,replay} from "../fleetweek/audit-helpers.mjs";
import {checkNotices,openMoves} from "../fleetweek/audit-closures.mjs";
import {checkConstantGate} from "../fleetweek/audit-repair-gates.mjs";
import {verifyScores} from "../fleetweek/verify-split.mjs";
import {hash} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data} from "./checkpoints.mjs";

const fresh=["position-relay","position-return","position-east","position-weave","position-late","position-ramp","position-pivot","position-transfer"];
const banks=[
  ["validation",["position-crossing","position-bend"],128,1250000000,[2,4,6],[1,2,3,4,5]],
  ["test",fresh,4096,1260000000,[3,5,7],[1,2,3,4,4,4,5,5,5]],
  ["clean",fresh,512,1270000000,null,null],["archive",["double-return"],4096,1280000000,null,null]
];
const refs=["rl","planner","flatRisk","shortGate","previous","warningPlanner","untrained"], comparators=refs.slice(1);
const report=JSON.parse(await readFile(new URL("results.json",data)));
assert.equal(report.suite,"dispatch-preposition-v1"); assert.deepEqual(report.fitSeeds,[73,101,211]);
assert.equal(report.primarySeed,73);
const {weights,hashes,fits}=await checkpoints();
const untrained={...fits[0].model,net:Array(fits[0].model.net.length).fill(0),service:Array(fits[0].model.service.length).fill(0)};
for(const [k,v] of Object.entries(hashes))assert.equal(report[k],v);
assert.deepEqual(report.weightHashes,Object.fromEntries(fits.map(f=>[f.seed,f.sha])));
const prior=makeSwitchCostPolicy(weights.parent,weights), flat=makeClosureFlatRisk(weights), short=makeLongRepairPolicy(weights.short,weights);
const constant=makeUncertaintyPolicy(weights.uncertainty,weights.override,{flatRisk:true});
async function readVerified(file,digest){const bytes=await readFile(new URL(file,data));assert.equal(hash(bytes),digest,file);return JSON.parse(bytes);}
function decision(p,model) {
  if(!p.warning)return p.parentId;
  const values=predictMenus(p,model), score=v=>v.net+v.service*model.settings.serviceCredit;
  assert.deepEqual(values.map(v=>v.id),p.menu.map(v=>v.id));assert(values.every(v=>Number.isFinite(v.net)&&Number.isFinite(v.service)));
  const incumbent=values.find(v=>v.id===p.parentId), best=Math.max(...values.map(score));
  if(best-score(incumbent)<=model.settings.hurdle)return p.parentId;
  return values.find(v=>score(v)===best).id;
}
const cServed=id=>/^C\||\|C$/.test(id);
function auditCase(c,config,examples) {
  const frames=closureFrames(config), underlying=publicFrames(config);
  checkNotices(frames,underlying,config.closure);
  const warning=frames.findIndex(o=>o.incident.status==="warning");
  assert.equal(c.warningEpoch,warning<0?null:warning);
  assert.equal(c.duration,frames.filter(o=>o.incident.status==="closed").length);
  assert.equal(c.closedAtEnd,frames.at(-1).incident.status==="closed");
  const boards=new Map();
  const board=(obs,all)=>{
    const key=obs.epoch*9+obs.positions[0]*3+obs.positions[1];
    if(!boards.has(key)){
      const legal=openMoves(obs,all), p=prepositionProposal(closureFrame(obs),legal,weights);
      const ids={previous:prior(obs,legal),shortGate:short(obs,legal),flatRisk:flat(obs,legal),planner:chooseClosurePlanner(obs,legal)};
      ids.warningPlanner=p.warning?ids.planner:ids.previous; ids.untrained=decision(p,untrained);
      assert(p.warning===(obs.incident.status==="warning"));
      assert.equal(p.parentId,ids.previous);assert.equal(p.shortId,ids.shortGate);assert.equal(p.constantId,ids.flatRisk);assert.equal(p.plannerId,ids.planner);
      const decisions=fits.map(f=>{
        const id=decision(p,f.model);assert.equal(decisionFromProposal(p,f.model).chosenId,id);
        return id;
      });
      boards.set(key,{legal,ids,decisions,epoch:obs.epoch});
    }return boards.get(key);
  };
  function run(choose,record) {
    const actions=[];
    const ledger=replay(frames,(obs,all)=>{
      const b=board(obs,all), id=choose(b);assert(b.legal.some(a=>a.id===id));actions.push(id);return id;
    },record);
    return {actions,ledger};
  }
  let warningMenu;
  run(b=>{if(b.epoch===warning)warningMenu=b.legal;return b.ids.previous;},c.previous);
  for(const k of ["planner","flatRisk","shortGate","warningPlanner","untrained"])run(b=>b.ids[k],c[k]);
  const paths=fits.map((f,i)=>run(b=>b.decisions[i],i===0?c.rl:undefined));
  if(warning>=0){
    const actualPlacement=path=>warningMenu.find(a=>a.id===path.actions[warning]).positions;
    assert.deepEqual(c.warningDestinations,{rl:actualPlacement(c.rl),previous:actualPlacement(c.previous)});
    for(const path of paths){
      assert.deepEqual(path.actions.slice(0,warning),c.previous.actions.slice(0,warning));
      if(path.actions[warning]===c.previous.actions[warning])assert.deepEqual(path,c.previous);
    }
  } else {
    assert.equal(c.warningDestinations,null);
    for(const path of [...paths,c.warningPlanner,c.untrained])assert.deepEqual(path,c.previous);
    assert.deepEqual(c.previous,c.flatRisk);
    replay(underlying,constant,c.flatRisk);replay(underlying,chooseFleetPlanner,c.planner);
  }
  if(examples && warning>=0){
    function inspect(kind,left,right,leftWho,rightWho) {
      if(examples.has(kind))return;
      for(const t of [8,9]) {
        const served=cServed(left.actions[t]), other=cServed(right.actions[t]);
        if(served===other || (kind==="agent-save"&&!served) || (kind==="agent-loss"&&served))continue;
        assert.notEqual(left.actions[warning],right.actions[warning]);
        assert.deepEqual(left.actions.slice(0,warning),right.actions.slice(0,warning));
        examples.set(kind,{...config,epoch:warning,fridayEpoch:t,kind,chosenId:left.actions[warning],
          alternativeId:right.actions[warning],chosenWho:leftWho,alternativeWho:rightWho,chosen:left,alternative:right});return;
      }
    }
    inspect("agent-save",c.rl,c.previous,"rl","previous"); inspect("agent-loss",c.rl,c.previous,"rl","previous");
    for(const a of warningMenu) {
      if(examples.has("alternative"))break;
      if(a.id===c.previous.actions[warning])continue;
      const forced=run(b=>b.epoch===warning?a.id:b.ids.previous);
      inspect("alternative",c.previous,forced,"previous","illustration");
    }
  }
  return paths.map(p=>p.ledger);
}
function auditContracts(rows,k,result) {
  const records=Array.from({length:10},(_,t)=>{
    const xs=rows.map(r=>[cServed(r.rl.actions[t]),cServed(r[k].actions[t])]);
    const count=(a,b)=>xs.reduce((n,[x,y])=>n+Number(x===a&&y===b),0);
    return {saved:count(true,false),lost:count(false,true),bothServed:count(true,true),bothMissed:count(false,false)};
  });
  const total=(field,from=0)=>records.slice(from).reduce((s,r)=>s+r[field],0);
  const saved=total("saved"), lost=total("lost");
  assert.deepEqual(result,{saved,lost,net:saved-lost,fridaySaved:total("saved",8),fridayLost:total("lost",8),byEpoch:records});
  assert.equal(saved-lost,rows.reduce((s,r)=>s+r.rl.ledger.served-r[k].ledger.served,0));
}

function auditPositioning(cases,result) {
  const warnings=cases.filter(c=>c.warningEpoch!==null);
  const category=c=>{
    const i=c.warningEpoch, dest=c.warningDestinations;
    if(c.rl.actions[i]===c.previous.actions[i])return "unchanged";
    if(dest.rl.join()===dest.previous.join())return "samePositions";
    return [...dest.rl].sort().join()===[...dest.previous].sort().join() ? "swappedTrucks" : "differentPlacement";
  };
  const empty=(c,party)=>c[party].actions[c.warningEpoch].split("|").filter(id=>/^E[012]$/.test(id)).length;
  for(const name of ["all","differentPlacement","swappedTrucks","samePositions","unchanged"]) {
    const rows=warnings.filter(c=>name==="all"||category(c)===name);
    const more=rows.filter(c=>empty(c,"rl")>empty(c,"previous")).length;
    const fewer=rows.filter(c=>empty(c,"rl")<empty(c,"previous")).length;
    const count=(win,scope)=>rows.reduce((n,c)=>n+c.rl.actions.filter((a,i)=>{
      return scope(i,c.warningEpoch) && cServed(a)===win && cServed(c.previous.actions[i])!==win;
    }).length,0);
    const at=(i,w)=>i===w, after=(i,w)=>i>w, friday=i=>i>=8;
    const expected={weeks:rows.length,netCredits:rows.reduce((n,c)=>n+c.rl.ledger.net-c.previous.ledger.net,0),
      emptyMore:more,emptyFewer:fewer,emptyEqual:rows.length-more-fewer,atWarningSaved:count(true,at),atWarningLost:count(false,at),
      afterSaved:count(true,after),afterLost:count(false,after),fridaySaved:count(true,friday),fridayLost:count(false,friday)};
    assert.deepEqual(result[name],expected);
  }
}
for(const [split,families,count,first,starts,durations] of banks) {
  const bank=await loadPrepositionBank(split,readVerified,report.banks[split]), s=report.splits[split];
  const rows=[],fitsByCase=[], examples=new Map(), cases=bank.cases;
  for(const [i,c] of cases.entries()){
    const j=Math.floor(i/count), config={family:families[j],seed:first+10000*j+i%count,closure:starts?{starts,durations}:null};
    for(const [k,v] of Object.entries(config))assert.deepEqual(c[k],v);
    fitsByCase.push(auditCase(c,config,split==="test"?examples:null));
    rows.push({family:c.family,agent:c.rl.ledger,duration:c.duration,...Object.fromEntries(refs.map(k=>[k,c[k].ledger]))});
  }
  assert.deepEqual(s.examples,["agent-save","agent-loss","alternative"].filter(k=>examples.has(k)).map(k=>examples.get(k)));
  for(const k of comparators)auditContracts(cases,k,s.contracts[k]);
  auditPositioning(cases,s.positioning);
  const countWeeks=fn=>cases.reduce((n,c)=>n+Number(fn(c)),0);
  const differs=(c,k)=>c.rl.actions.some((id,t)=>id!==c[k].actions[t]);
  assert.deepEqual(s.diagnostics,{warnings:countWeeks(c=>c.warningEpoch!==null),changedWarnings:countWeeks(c=>c.warningEpoch!==null&&c.previous.actions[c.warningEpoch]!==c.rl.actions[c.warningEpoch]),
    changedWeeks:countWeeks(c=>differs(c,"previous")),closedAtEnd:countWeeks(c=>c.closedAtEnd),constantWeekDifferences:countWeeks(c=>differs(c,"flatRisk")),
    constantActionDifferences:cases.reduce((n,c)=>n+c.rl.actions.filter((id,t)=>id!==c.flatRisk.actions[t]).length,0)});
  function scores(group,summary){verifyScores(group,summary,refs);checkConstantGate(summary);}
  scores(rows,s.summary.all);
  for(const f of families)scores(rows.filter(r=>r.family===f),s.summary.byFamily[f]);
  if(starts){
    scores(rows.filter(r=>r.duration<=3),s.durationGroups.short);
    scores(rows.filter(r=>r.duration>=4),s.durationGroups.long);
    for(const d of new Set(rows.map(r=>r.duration)))scores(rows.filter(r=>r.duration===d),s.byDuration[d]);
  }
  for(const [i,f] of fits.entries()){
    const b=rows.map((r,j)=>({...r,agent:fitsByCase[j][i]})), av=average(b,"agent");
    assert.deepEqual(s.fits[i],{seed:f.seed,net:av.net,onTime:av.onTime,...Object.fromEntries(comparators.map(k=>[k,paired(b,k)]))});
  }
  console.log("Independently audited",split,cases.length,"weeks,",cases.length*9,"policy paths and all Friday forks.");
}
const c=report.splits.test.summary.all.comparisons;
const pass={deliveriesFit73:c.previous.service95[0]>0,profitFit73:c.previous.net95[0]>0,
  deliveriesPlanner:c.planner.service95[0]>0,profitPlanner:c.planner.net95[0]>0};
assert.deepEqual(report.goals,{...pass,joint:Object.values(pass).every(Boolean)});
