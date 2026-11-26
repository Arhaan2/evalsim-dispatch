// A repair-specific Bellman planner. Tomorrow's dispatcher observes the actual
// status and issued field report before assigning that board's signed loads.
import {bestFleetAction, fleetBellmanStep, fleetContinuationFromProjection, fleetRewardTable,
  fleetRewardTables, fleetWeekHubProjection} from "./fleetweek-planner.js";
import {closureActions, closureDurations, CLOSURE_DELAY_LIKELIHOODS} from "./closure-world.js";
import {isOvernight} from "./overnight-policy.js";
import {overrideContext} from "./override-policy.js";
import {candidateOnFrame,estimateCandidate,uncertaintyDecision} from "./uncertainty-policy.js";

const closedTables=[];
function closedRewardTables(depot) {
  const byBoard=board=>closureActions({...board,incident:{status:"closed",depot}});
  return closedTables[depot]??=[fleetRewardTable(0,byBoard),fleetRewardTable(1,byBoard)];
}
function noticeAt(t, start, path) {
  if (t>=start+path.duration) return "open";
  return t===start ? "closed" : path.update;
}

// The tree is independent of the demand bulletin and depot identity. At most
// three distinct future public repair states are possible on any one board.
const repairTrees=new Map();
function repairTree(obs) {
  const {epoch,incident:{start,status,update}}=obs;
  const key=[epoch,start,status,update].join("|");
  if (repairTrees.has(key)) return repairTrees.get(key);
  const paths=[];
  for (const [i,p] of closureDurations(obs).entries()) {
    if (!p) continue;
    if (update) paths.push({duration:i+1,update,p});
    else {
      const delayed=CLOSURE_DELAY_LIKELIHOODS[i];
      paths.push({duration:i+1,update:"delayed",p:p*delayed},
        {duration:i+1,update:"on-track",p:p*(1-delayed)});
    }
  }
  const levels=[];
  for (let t=epoch;t<10;t++) {
    const groups=new Map();
    for (const path of paths) {
      const state=t===epoch ? "current" : noticeAt(t,start,path);
      if (!groups.has(state)) groups.set(state,{state,mass:0,children:new Map()});
      const group=groups.get(state);
      const child=noticeAt(t+1,start,path);
      group.mass+=path.p;
      group.children.set(child,(group.children.get(child)??0)+path.p);
    }
    levels.push([...groups.values()].map(({state,mass,children})=>({state,
      transitions:[...children].map(([next,weight])=>({next,weight:weight/mass}))})));
  }
  repairTrees.set(key,levels);
  return levels;
}
function mixFuture(transitions, future) {
  if (transitions.length===1) return future.get(transitions[0].next);
  const mixed=new Float64Array(18);
  for (const {next,weight} of transitions) {
    const values=future.get(next);
    for (let i=0;i<18;i++) mixed[i]+=weight*values[i];
  }
  return mixed;
}
export function closureContinuation(obs, posterior=fleetWeekHubProjection(obs)) {
  const {epoch,hub,incident}=obs;
  if (epoch===9) return new Float64Array(6);
  if (!incident || incident.status==="clear" || incident.status==="reopened") {
    return fleetContinuationFromProjection(epoch,hub,posterior);
  }
  const levels=repairTree(obs), terminal=new Float64Array(18);
  const open=fleetRewardTables(), closed=closedRewardTables(incident.depot);
  let future;
  for (let t=9;t>epoch;t--) {
    const layer=new Map();
    for (const {state,transitions} of levels[t-epoch]) {
      const next=t===9 ? terminal : mixFuture(transitions,future);
      const boards=(state==="open" ? open : closed)[t%2];
      layer.set(state,fleetBellmanStep(boards,posterior[t],next));
    }
    future=layer;
  }
  return mixFuture(levels[0][0].transitions,future).subarray(6*hub,6*hub+6);
}

const cache=new WeakMap();
export function closureFrame(obs) {
  let frame=cache.get(obs);
  if (!frame) {
    const base=closureContinuation(obs);
    const context=isOvernight(obs.epoch) ? overrideContext(obs,base,(_epoch,_hub,posterior)=>
      closureContinuation(obs,posterior)) : null;
    frame={obs,base,context};
    cache.set(obs,frame);
  }
  return frame;
}
export function chooseClosurePlanner(obs, menu=closureActions(obs)) {
  return bestFleetAction(menu,closureFrame(obs).base);
}
export function flatRiskOnFrame(frame,menu,{override,uncertainty}) {
  const candidate=candidateOnFrame(frame,menu,override);
  return uncertaintyDecision(candidate,estimateCandidate(candidate,uncertainty),
    uncertainty.settings,uncertainty.flatDownside,{flatRisk:true}).chosenId;
}
export function makeClosureFlatRisk(weights) {
  return (obs,menu=closureActions(obs))=>flatRiskOnFrame(closureFrame(obs),menu,weights);
}
