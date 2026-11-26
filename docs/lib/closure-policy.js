// Compare the incumbent's empty moves with legal placements on the same board.
// Nothing beyond the published repair bulletin and the dispatcher's freight history enters a fit.
import {FLEET_PAIRS,fleetPairIndex,fleetWeekBoardScenarios} from "./fleetweek.js";
import {bestFleetAction,fleetWeekHubProjection} from "./fleetweek-planner.js";
import {distinctOverrides} from "./override-policy.js";
import {closureProbabilities} from "./closure-world.js";
import {closureFrame,flatRiskOnFrame} from "./closure-planner.js";

const center=values=>{
  const mean=values.reduce((total,value)=>total+value,0)/values.length;
  return Array.from(values,value=>value-mean);
};
const dot=(x,w)=>x.reduce((total,value,i)=>total+value*w[i],0);
const leader=row=>row.indexOf(Math.max(...row));

export function isClosureDecision(obs) {
  return obs.epoch<9 && (obs.incident.status==="warning" || obs.incident.status==="closed");
}

// Each row describes the same public board conditional on an unordered ending
// truck placement. Count whether next round's hard contract could be covered
// under the public distribution of hubs, orders and depot capacity.
export function closureFeatures(frame) {
  const obs=frame.obs, t=obs.epoch, d=obs.incident.depot;
  const next=t+1, later=Math.min(9,t+2);
  const chance=closureProbabilities(obs), closedNext=chance[next], closedLater=chance[later];
  const projected=fleetWeekHubProjection(obs);
  const hubMass=projected[next].map((p,h)=>0.68*p+0.21*Number(obs.hub===h)+0.11/3);
  const contractAt=[0,0,0];
  for (const board of fleetWeekBoardScenarios(next)) {
    const contract=board.orders[0];
    const touches=contract.origin===d || contract.destination===d;
    contractAt[contract.origin]+=board.weight*hubMass[board.hub]*(touches ? 1-closedNext : 1);
  }
  const known=obs.history.map(b=>b.hub).concat(obs.hub);
  const calledNext=leader(obs.forecast[next]), calledLater=leader(obs.forecast[later]);
  const warning=Number(obs.incident.status==="warning");
  const delayed=Number(obs.incident.update==="delayed");
  const onTrack=Number(obs.incident.update==="on-track");
  const time=(9-t)/9, age=Math.max(0,t-obs.incident.start)/4;
  const evidence=[0,1,2].map(h=>[
    1, Number(h===d), Number(h===d)*closedNext, Number(h===d)*closedLater,
    Number(h===d)*warning, Number(h===d)*age, Number(h===d)*delayed, Number(h===d)*onTrack,
    Number(h===calledNext), Number(h===calledLater), hubMass[h], projected[later][h],
    contractAt[h], Number(h===obs.hub), Number(h===known[0]),
    known.filter(x=>x===h).length/known.length, Number(h===calledNext)*closedNext,
    contractAt[h]*time, contractAt[h]*warning, contractAt[h]*delayed,
    Number(h===0), Number(h===1), Number(h===2), Number(h===(d+1)%3)*closedNext,
    Number(h===(d+2)%3)*closedNext,
  ]);
  const bases=center(frame.base);
  const service=center(FLEET_PAIRS.map(pair=>contractAt.reduce((s,p,h)=>s+p*Number(pair.includes(h)),0)));
  const raw=FLEET_PAIRS.map((pair,i)=>{
    const features=[bases[i]/35, bases[i]/35*time, bases[i]/35*closedNext,
      bases[i]/35*warning, bases[i]/35*delayed, service[i], service[i]*closedLater];
    for (const covered of [h=>Number(pair.includes(h)),h=>Number(pair[0]===h && pair[1]===h)]) {
      for (let j=0;j<evidence[0].length;j++) {
        let value=0;
        for (let h=0;h<3;h++) value+=covered(h)*evidence[h][j];
        features.push(value);
      }
    }
    return features;
  });
  const mean=raw[0].map((_,j)=>raw.reduce((s,row)=>s+row[j],0)/raw.length);
  const x=raw.map(row=>[1,...row.map((value,j)=>value-mean[j])]);
  return {x,base:bases,service};
}

export function closureChoices(frame,menu,weights) {
  const plannerId=bestFleetAction(menu,frame.base);
  const constantId=flatRiskOnFrame(frame,menu,weights);
  const constant=menu.find(a=>a.id===constantId);
  return {plannerId,constant,alternatives:isClosureDecision(frame.obs) ? distinctOverrides(menu,constant) : []};
}

export function prepareClosureValues(frame,model) {
  const f=closureFeatures(frame);
  return {net:f.x.map(x=>dot(x,model.net)*model.calibration.net),
    service:f.x.map((x,i)=>f.service[i]+dot(x,model.service)*model.calibration.service)};
}

export function closureEstimates(frame,choices,model,provided) {
  if (!choices.alternatives.length) return [];
  const values=provided ?? prepareClosureValues(frame,model);
  const from=fleetPairIndex(choices.constant.positions);
  return choices.alternatives.map(action=>{
    const to=fleetPairIndex(action.positions);
    const base=action.net-choices.constant.net+frame.base[to]-frame.base[from];
    const correction=values.net[to]-values.net[from];
    return {action,base,correction,net:base+correction,service:values.service[to]-values.service[from]};
  });
}

export function selectClosure(choices,estimates,settings) {
  let best=null, bestScore=-Infinity, bestNet=null;
  for (const item of estimates) {
    const net=item.base+settings.blend*item.correction;
    const score=net+settings.serviceCredit*item.service;
    if (score>bestScore) {best=item;bestScore=score;bestNet=net;}
  }
  const switches=best!==null && !settings.constantOnly && bestScore>settings.hurdle;
  return {plannerId:choices.plannerId,constantId:choices.constant.id,
    chosenId:switches ? best.action.id : choices.constant.id,eligible:best!==null,
    expectedNet:switches ? bestNet : 0,expectedService:switches ? best.service : 0,
    score:switches ? bestScore : 0,proposalId:best?.action.id ?? null,
    proposalNet:bestNet,proposalService:best?.service ?? null,proposalScore:best ? bestScore : null};
}

export function inspectClosure(obs,menu,model,weights) {
  const frame=closureFrame(obs);
  const choices=closureChoices(frame,menu,weights);
  return selectClosure(choices,closureEstimates(frame,choices,model),model.settings);
}

export function makeClosurePolicy(model,weights) {
  return (obs,menu)=>inspectClosure(obs,menu,model,weights).chosenId;
}
