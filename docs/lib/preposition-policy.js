import {FLEET_PAIRS, fleetPairIndex, fleetWeekBoardScenarios} from "./fleetweek.js";
import {closureActions} from "./closure-world.js";
import {closureFrame} from "./closure-planner.js";
import {fleetWeekHubProjection} from "./fleetweek-planner.js";
import {switchCostProposal,switchCostDecision} from "./switchcost-policy.js";

// Open and closed next-board values are computable from the public freight menu.
const boardValues=new Map();
function nextValues(epoch,depot) {
  const key=(epoch%2)*3+depot;
  if (boardValues.has(key)) return boardValues.get(key);
  const values=FLEET_PAIRS.map(positions=>{
    const byHub=Array.from({length:3},()=>[0,0]);
    for (const b of fleetWeekBoardScenarios(epoch)) {
      const menu=closureActions({positions,orders:b.orders,incident:{status:"closed",depot}});
      byHub[b.hub][0]+=b.weight*Math.max(...menu.map(a=>a.net));
      byHub[b.hub][1]+=b.weight*Math.max(...menu.map(a=>a.served));
    }
    return byHub;
  });
  boardValues.set(key,values);
  return values;
}

export function warningFeatures(frame) {
  const {obs,base}=frame;
  if (obs.incident.status!=="warning") throw new Error("A public warning is required.");
  const next=obs.epoch+1,later=Math.min(9,next+1),third=Math.min(9,next+2),closed=obs.incident.depot;
  const projected=fleetWeekHubProjection(obs), boards=nextValues(next,closed);
  const signedOrigin=(closed+(next%2===0 ? 1 : 2))%3;
  const openOther=3-closed-signedOrigin;
  const latest=obs.history.at(-1)?.hub??obs.hub, horizon=(9-obs.epoch)/9;
  const nextMass=projected[next].map((p,h)=>.68*p+.21*Number(obs.hub===h)+.11/3);
  const direct=obs.forecast[next].map((p,h)=>.68*p+.21*Number(obs.hub===h)+.11/3);
  const raw=FLEET_PAIRS.map((pair,i)=>{
    const has=h=>Number(pair.includes(h)), both=h=>Number(pair[0]===h && pair[1]===h);
    const spread=Number(pair[0]!==pair[1]);
    const coverage=row=>row.reduce((s,p,h)=>s+p*has(h),0);
    const expected=(mass,head)=>mass.reduce((s,p,h)=>s+p*boards[i][h][head],0);
    const net=expected(nextMass,0)/35, served=expected(nextMass,1);
    const baseNet=base[i]/35;
    const features=[baseNet,baseNet*horizon,net,served,expected(direct,0)/35,expected(direct,1),
      net*horizon,served*horizon,spread,spread*horizon,has(closed),both(closed),has(signedOrigin),both(signedOrigin),
      has(openOther),both(openOther),has(obs.hub),has(latest),coverage(projected[next]),coverage(obs.forecast[next]),
      coverage(projected[later]),coverage(obs.forecast[later]),coverage(obs.forecast[third])];
    // The depot left open for the signed route alternates with the half-day.
    for (const h of [closed,signedOrigin,openOther]) {
      features.push(has(h)*projected[next][h],has(h)*obs.forecast[next][h],has(h)*Number(obs.hub===h),
        has(h)*obs.forecast[later][h],has(h)*horizon,has(h)*Number(next%2===0),has(h)*Number(h===0),has(h)*Number(h===1));
    }
    for (const h of [0,1,2]) features.push(boards[i][h][0]/35,boards[i][h][1]);
    return features;
  });
  const means=raw[0].map((_,j)=>raw.reduce((s,x)=>s+x[j],0)/raw.length);
  const meanBase=Array.from(base).reduce((s,v)=>s+v,0)/base.length;
  return {x:raw.map(x=>[1,...x.map((v,j)=>v-means[j])]),base:Array.from(base,v=>v-meanBase)};
}

export function prepositionProposal(frame,menu,weights) {
  const parent=switchCostDecision(switchCostProposal(frame,menu,weights),weights.parent);
  const warning=frame.obs.incident.status==="warning";
  return {warning,menu,parentId:parent.chosenId,plannerId:parent.plannerId,shortId:parent.shortId,constantId:parent.constantId,
    features:warning ? warningFeatures(frame) : null};
}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function predictMenus(proposal,model) {
  const {x,base}=proposal.features;
  const net=x.map((f,i)=>base[i]+dot(f,model.net));
  const service=x.map(f=>dot(f,model.service));
  return proposal.menu.map(action=>{
    const p=fleetPairIndex(action.positions);
    return {id:action.id,net:action.net+net[p],service:action.served+service[p]};
  });
}
export function choosePosition(menu,parentId,settings) {
  const parent=menu.find(a=>a.id===parentId);
  const score=a=>a.net+settings.serviceCredit*a.service;
  let best=parent,bestScore=score(parent);
  for (const a of menu) {
    const value=score(a);
    if (value>bestScore) {best=a;bestScore=value;}
  }
  if (bestScore-score(parent)<=settings.hurdle) best=parent;
  return {chosenId:best.id,predictedNetGain:best.net-parent.net,predictedServiceGain:best.service-parent.service};
}
export function decisionFromProposal(p,model) {
  const decision=p.warning ? choosePosition(predictMenus(p,model),p.parentId,model.settings) :
    {chosenId:p.parentId,predictedNetGain:0,predictedServiceGain:0};
  return {...decision,parentId:p.parentId,plannerId:p.plannerId,warning:p.warning};
}
export function inspectPreposition(obs,menu,model,weights) {
  return decisionFromProposal(prepositionProposal(closureFrame(obs),menu,weights),model);
}
export function makePrepositionPolicy(model,weights) {
  return (obs,menu)=>inspectPreposition(obs,menu,model,weights).chosenId;
}
