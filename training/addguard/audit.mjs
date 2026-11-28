// Independently replay each truck and each Friday branch, then recompute paired inference.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {closureFrames} from "../../docs/lib/closure-world.js";
import {chooseClosurePlanner,makeClosureFlatRisk,closureFrame} from "../../docs/lib/closure-planner.js";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {makeUncertaintyPolicy} from "../../docs/lib/uncertainty-policy.js";
import {makeLongRepairPolicy} from "../../docs/lib/longrepair-policy.js";
import {makeMoveRecallPolicy} from "../../docs/lib/moverecall-policy.js";
import {makeSwitchCostPolicy} from "../../docs/lib/switchcost-policy.js";
import {addGuardProposal,addGuardDecision} from "../../docs/lib/addguard-policy.js";
import {loadAddGuardBank} from "../../docs/lib/addguard-study.js";
import {paired,average,publicFrames,replay} from "../fleetweek/audit-helpers.mjs";
import {checkNotices,openMoves} from "../fleetweek/audit-closures.mjs";
import {checkConstantGate} from "../fleetweek/audit-repair-gates.mjs";
import {checkCostComparison} from "../switchcost/audit-cost.mjs";
import {checkDetectorRows,checkDetectorInterval} from "../longmove/audit-detector.mjs";
import {verifyScores} from "../fleetweek/verify-split.mjs";
import {hash} from "../fleetweek/score-helpers.mjs";
import {checkpoints,data} from "./checkpoints.mjs";

const fresh=["guard-return","guard-ramp","guard-departure","guard-loop","guard-handoff","guard-relay","guard-split","guard-turn"];
const banks=[
  ["validation",["guard-crossing","guard-pivot"],128,1150000000,[1],[1,2,3,4,4,5,5]],
  ["test",fresh,8192,1160000000,[3,5],[1,2,3,4,4,4,5,5,5]],
  ["clean",fresh,512,1170000000,null,null],["archive",["double-return"],4096,1180000000,null,null],
];
const refs=["rl","planner","flatRisk","shortGate","previous","original"];
const report=JSON.parse(await readFile(new URL("results.json",data)));
async function verified(name,sha) {
  const bytes=await readFile(new URL(name,data));
  assert.equal(hash(bytes),sha);
  return JSON.parse(bytes);
}
const {weights,hashes,fits}=await checkpoints(), seeds=[73,101,211];
assert.equal(report.suite,"dispatch-addguard-v1");
assert.equal(report.primarySeed,73);
assert.deepEqual(report.fitSeeds,seeds);
for (const [k,v] of Object.entries(hashes)) assert.equal(report[k],v);
assert.deepEqual(report.weightHashes,Object.fromEntries(fits.map(f=>[f.seed,f.sha])));
const policies={shortGate:makeLongRepairPolicy(weights.short,weights),longGate:makeLongRepairPolicy(weights.long,weights),
  previous:makeSwitchCostPolicy(weights.parent,weights),original:makeMoveRecallPolicy(weights.recall,weights),
  flatRisk:makeClosureFlatRisk(weights),planner:chooseClosurePlanner};
const originalConstant=makeUncertaintyPolicy(weights.uncertainty,weights.override,{flatRisk:true});

function auditCase(c,config) {
  const frames=closureFrames(config), underlying=publicFrames(config);
  checkNotices(frames,underlying,config.closure);
  assert.equal(c.duration,frames.filter(o=>o.incident.status==="closed").length);
  const boards=new Map();
  function trace(decide,stored) {
    const actions=[];
    const ledger=replay(frames,(obs,all)=>{
      const key=obs.epoch*9+3*obs.positions[0]+obs.positions[1];
      if (!boards.has(key)) {
        const legal=openMoves(obs,all), ids=Object.fromEntries(Object.entries(policies).map(([k,fn])=>[k,fn(obs,legal)]));
        const proposal=addGuardProposal(closureFrame(obs),legal,weights);
        const target=ids.shortGate!==ids.longGate && ids.previous===ids.longGate && ids.original===ids.shortGate;
        assert.equal(proposal.guardEligible,target);
        assert.equal(proposal.parent.added,target);
        const predictions=fits.map(({model})=>{
          const d=addGuardDecision(proposal,model), estimates=d.guardEstimates;
          assert.equal(d.guardEligible,target); assert.equal(d.parentId,ids.previous);
          const risk=target ? estimates.downside-estimates.upside-12*estimates.service+12*estimates.loss-18*estimates.win : null;
          const veto=target && model.settings.above!==null && risk>model.settings.above;
          assert.equal(d.guardRisk,risk);
          assert.equal(d.guardVetoed,veto);
          assert.equal(d.chosenId,veto ? ids.shortGate : ids.previous);
          return {switched:d.chosenId===ids.longGate,guardRisk:risk,guardEstimates:estimates,id:d.chosenId,veto};
        });
        boards.set(key,{obs,legal,ids,predictions,target});
      }
      const board=boards.get(key), id=decide(board);
      assert(board.legal.some(a=>a.id===id)); actions.push(id); return id;
    },stored);
    return {actions,ledger};
  }
  let eligibleBoards=0, vetoedBoards=0;
  trace(b=>{eligibleBoards+=Number(b.target);vetoedBoards+=Number(b.predictions[0].veto);return b.predictions[0].id;},c.rl);
  for (const k of ["planner","flatRisk","previous","original"]) trace(b=>b.ids[k],c[k]);
  const fixed=[];
  trace(({obs,ids,predictions,target})=>{
    if (ids.shortGate!==ids.longGate) {
      fixed.push({epoch:obs.epoch,status:obs.incident.status,shortId:ids.shortGate,longId:ids.longGate,guardEligible:target,
        previous:{switched:ids.previous===ids.longGate},original:{switched:ids.original===ids.longGate},
        predictions:predictions.map(({id,veto,...p})=>p)});
    }
    return ids.shortGate;
  },c.shortGate);
  assert.equal(c.opportunities.length,fixed.length);
  for (const [i,decision] of fixed.entries()) {
    const alternative=trace(b=>b.obs.epoch<decision.epoch ? c.shortGate.actions[b.obs.epoch] :
      b.obs.epoch===decision.epoch ? decision.longId : b.ids.shortGate,c.opportunities[i].alternative);
    assert.deepEqual(c.opportunities[i],{...decision,alternative,netGain:alternative.ledger.net-c.shortGate.ledger.net,
      serviceGain:alternative.ledger.served-c.shortGate.ledger.served});
  }
  const ledgers=[c.rl.ledger,...fits.slice(1).map((f,i)=>trace(b=>b.predictions[i+1].id).ledger)];
  if (!config.closure) {
    for (const name of ["rl","shortGate","previous","original"]) assert.deepEqual(c[name],c.flatRisk);
    for (const ledger of ledgers) assert.deepEqual(ledger,c.flatRisk.ledger);
    replay(underlying,originalConstant,c.flatRisk); replay(underlying,chooseFleetPlanner,c.planner);
  }
  return {eligibleBoards,vetoedBoards,ledgers};
}
function auditRecognition(rows,index,actual) {
  const moves={rl:r=>r.predictions[index].switched,previous:r=>r.previous.switched,original:r=>r.original.switched};
  for (const [name,take] of Object.entries(moves)) {
    const put=rows.filter(take),wins=put.filter(r=>r.netGain>0),losses=put.filter(r=>r.netGain<0), nWin=rows.filter(r=>r.netGain>0).length;
    assert.deepEqual(actual.outcomes[name],{accepted:put.length,wins:wins.length,losses:losses.length,ties:put.filter(r=>r.netGain===0).length,
      winningCredits:wins.reduce((s,r)=>s+r.netGain,0),losingCredits:losses.reduce((s,r)=>s+r.netGain,0),
      precision:put.length?wins.length/put.length:null,recall:nWin?wins.length/nWin:null});
  }
  for (const [key,newId,oldId] of [["vsParent","rl","previous"],["vsMoveRecall","rl","original"],["parentVsMoveRecall","previous","original"]]) {
    const pairs=rows.map(r=>({...r,previous:{switched:moves[oldId](r)},predictions:[{switched:moves[newId](r)}]}));
    assert.deepEqual(actual[key],checkCostComparison(pairs,0));
  }
}
function auditGroups(rows,i,result) {
  auditRecognition(rows,i,result.all); auditRecognition(rows.filter(r=>r.guardEligible),i,result.added);
  assert.equal(result.all.vsParent.recovered,0);
  assert.equal(result.all.vsParent.addedLosses,0);
  assert.equal(result.all.vsParent.avoidedLosses,result.added.vsParent.avoidedLosses);
}
function auditExamples(cases,result) {
  const ordered=cases.flatMap(c=>c.opportunities.filter(o=>o.guardEligible).map(o=>({c,o})));
  let n=0;
  for (const change of ["vetoed","retained"]) for (const outcome of ["loss","win","tie"]) {
    const match=ordered.find(({o})=>o.predictions[0].switched===(change==="retained") &&
      Math.sign(o.netGain)==={loss:-1,win:1,tie:0}[outcome]);
    if (!match) continue;
    const {o,c}=match, kept=change==="retained", e=result.examples[n++];
    assert.equal(e.family,c.family); assert.equal(e.seed,c.seed); assert.equal(e.epoch,o.epoch);
    assert.equal(e.duration,c.duration); assert.deepEqual(e.closure,c.closure); assert.equal(e.status,o.status);
    assert.equal(e.change,change); assert.equal(e.outcome,outcome);
    assert.deepEqual(e.guardEstimates,o.predictions[0].guardEstimates); assert.equal(e.guardRisk,o.predictions[0].guardRisk);
    assert.equal(e.shortId,o.shortId); assert.equal(e.longId,o.longId);
    assert.equal(e.previousChoiceId,o.longId); assert.equal(e.originalChoiceId,o.shortId);
    assert.deepEqual(e.chosen,kept?o.alternative:c.shortGate); assert.deepEqual(e.alternative,kept?c.shortGate:o.alternative);
    assert.equal(e.chosen.actions[e.epoch],e.chosenId); assert.equal(e.alternative.actions[e.epoch],e.alternativeId);
    assert.equal(e.longGain,o.netGain); assert.equal(e.netGain,e.chosen.ledger.net-e.alternative.ledger.net);
    assert.equal(e.serviceGain,e.chosen.ledger.served-e.alternative.ledger.served);
  }
  assert.equal(result.examples.length,n);
}

for (const [split,families,count,first,starts,durations] of banks) {
  const bank=await loadAddGuardBank(split,verified,report.banks[split]), result=report.splits[split];
  const rows=[],ledgers=[],fixed=[];
  const diagnostics={eligibleBoards:0,vetoedBoards:0,weeksChanged:0,changedActions:0,constantActionDifferences:0,constantWeekDifferences:0};
  for (const [i,c] of bank.cases.entries()) {
    const j=Math.floor(i/count), config={family:families[j],seed:first+j*10000+i%count,closure:starts?{starts,durations}:null};
    for (const [k,v] of Object.entries(config)) assert.deepEqual(c[k],v);
    const audited=auditCase(c,config);
    rows.push({family:c.family,agent:c.rl.ledger,duration:c.duration,...Object.fromEntries(refs.map(k=>[k,c[k].ledger]))});
    fixed.push(...c.opportunities.map(o=>({...o,seed:c.seed,family:c.family,duration:c.duration})));
    ledgers.push(audited.ledgers);
    diagnostics.eligibleBoards+=audited.eligibleBoards; diagnostics.vetoedBoards+=audited.vetoedBoards;
    const diff=k=>c[k].actions.reduce((s,a,t)=>s+Number(a!==c.rl.actions[t]),0);
    diagnostics.weeksChanged+=Number(diff("previous")>0); diagnostics.changedActions+=diff("previous");
    diagnostics.constantWeekDifferences+=Number(diff("flatRisk")>0); diagnostics.constantActionDifferences+=diff("flatRisk");
  }
  assert.deepEqual(result.diagnostics,diagnostics);
  auditExamples(bank.cases,result);
  function scores(group,summary) {verifyScores(group,summary,refs);checkConstantGate(summary);}
  scores(rows,result.summary.all);
  for (const f of families) {
    scores(rows.filter(r=>r.family===f),result.summary.byFamily[f]);
    auditGroups(fixed.filter(r=>r.family===f),0,result.detection.byFamily[f]);
  }
  if (starts) {
    scores(rows.filter(r=>r.duration<=3),result.durationGroups.short);
    scores(rows.filter(r=>r.duration>=4),result.durationGroups.long);
    for (const n of [1,2,3,4,5]) scores(rows.filter(r=>r.duration===n),result.byDuration[n]);
  }
  for (const duration of new Set(fixed.map(r=>r.duration))) auditGroups(fixed.filter(r=>r.duration===duration),0,result.detection.byDuration[duration]);
  auditGroups(fixed,0,result.detection);
  for (const [i,f] of result.fits.entries()) {
    assert.equal(f.seed,seeds[i]);
    const group=rows.map((r,j)=>({...r,agent:ledgers[j][i]}));
    const averages=average(group,"agent");
    assert.equal(f.net,averages.net); assert.equal(f.onTime,averages.onTime);
    for (const key of refs.filter(k=>k!=="rl")) assert.deepEqual(f[key],paired(group,key));
    auditGroups(fixed,i,f);
    const targets=fixed.filter(r=>r.guardEligible).map(r=>({...r,netGain:-r.netGain,
      predictions:[{probability:r.predictions[i].guardEstimates.loss,switched:!r.predictions[i].switched}]}));
    const rate=fits[i].model.calibration.loss.mean;
    const {n,profitable:costly,auroc,brier,baseRate,baseBrier}=checkDetectorRows(targets,0,rate);
    assert.deepEqual(f.lossForecast,{n,costly,auroc,brier,baseRate,baseBrier,...checkDetectorInterval(targets,rate)});
  }
  console.log("Independently audited",split,rows.length,"weeks,",8*rows.length,"policy trajectories and",fixed.length,"short-path forks.");
}
const {all,added}=report.splits.test.detection, profit=r=>r.net95[0]>0, service=r=>r.service95[0]>=0 && r.servicePP>=0;
const c=report.splits.test.summary.all.comparisons;
const goals={lossReduction:(added.vsParent.loss95?.[0]??-Infinity)>0,
  recall:(all.vsParent.recallDifference??-Infinity)>=0 && (all.vsParent.recall95?.[0]??-Infinity)>=0,
  freshShortProfit:profit(c.shortGate),freshShortService:service(c.shortGate),freshFlatProfit:profit(c.flatRisk),
  freshFlatService:service(c.flatRisk),freshProfit:profit(c.planner),freshService:service(c.planner),
  doubleReturn:profit(report.splits.archive.summary.all.comparisons.planner)};
assert.deepEqual(report.goals,{...goals,joint:Object.values(goals).every(Boolean)});
