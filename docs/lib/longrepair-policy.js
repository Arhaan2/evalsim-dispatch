// One-step policy improvement over a frozen dispatcher. A gate may accept only
// the same-freight placement proposed by the published closure policy.
import {fleetPairIndex} from "./fleetweek.js";
import {closureDurations,closureProbabilities} from "./closure-world.js";
import {closureFrame} from "./closure-planner.js";
import {closureChoices,closureEstimates,selectClosure} from "./closure-policy.js";

function gateFeatures(frame,constant,alternative,prior) {
  const {obs,base}=frame, {depot,start,status,update}=obs.incident, t=obs.epoch;
  const posterior=closureDurations(obs), closed=closureProbabilities(obs);
  const long=posterior[3]+posterior[4], age=Math.max(0,t-start), left=9-t;
  const next=t+1, later=Math.min(t+2,9);
  const warning=Number(status==="warning"), delayed=Number(update==="delayed");
  const time=left/9, closedNext=closed[next], closedLater=closed[later];
  const net=prior.expectedNet, service=prior.expectedService;
  const immediate=alternative.net-constant.net;
  const baseGain=immediate+base[fleetPairIndex(alternative.positions)]-base[fleetPairIndex(constant.positions)];
  const covers=d=>Number(alternative.positions.includes(d))-Number(constant.positions.includes(d));
  const weighted=weights=>weights.reduce((sum,w,d)=>sum+w*covers(d),0);
  const openContract=Number(![obs.orders[0].origin,obs.orders[0].destination].includes(depot) || warning);
  const contract=covers(obs.orders[0].origin), atClosed=covers(depot), hub=covers(obs.hub);
  const bulletin=weighted(obs.forecast[next]), laterBulletin=weighted(obs.forecast[later]);
  const recent=obs.history.length ? covers(obs.history.at(-1).hub) : 0;
  const spread=p=>Number(p[0]!==p[1]);
  const diversity=spread(alternative.positions)-spread(constant.positions);
  return [1,net,service,immediate,baseGain,time,age,warning,delayed,Number(update==="on-track"),
    long,closedNext,closedLater,net*long,service*long,immediate*long,baseGain*long,
    net*time,service*time,net*warning,service*warning,
    atClosed,atClosed*closedNext,atClosed*closedLater,atClosed*age,atClosed*delayed,
    contract,openContract,contract*openContract,constant.served,diversity,diversity*long,
    hub,recent,bulletin,laterBulletin,hub*long,bulletin*closedNext,laterBulletin*closedLater,
    ...obs.orders.slice(1).map(order=>covers(order.origin)*(order.revenue-order.loadedCost)),
    ...[0,1,2].map(covers)];
}

export function longRepairProposal(frame,menu,weights,prepared) {
  const choices=closureChoices(frame,menu,weights);
  const estimates=closureEstimates(frame,choices,weights.closure,prepared);
  const prior=selectClosure(choices,estimates,weights.closure.settings);
  const eligible=prior.chosenId!==prior.constantId;
  const x=eligible ? gateFeatures(frame,choices.constant,menu.find(a=>a.id===prior.chosenId),prior) : null;
  return {plannerId:prior.plannerId,constantId:prior.constantId,closureId:prior.chosenId,eligible,
    priorNet:prior.expectedNet,priorService:prior.expectedService,x};
}

export function uncalibratedAdvantage(proposal,model) {
  const x=proposal.x;
  let net=proposal.priorNet+model.net[0], service=proposal.priorService+model.service[0];
  for (let i=1;i<x.length;i++) {
    const z=(x[i]-model.center[i])/model.scale[i];
    net+=z*model.net[i];
    service+=z*model.service[i];
  }
  return [net,service];
}

export function gateAdvantage(proposal,model,{flatGate=false}={}) {
  if (!proposal.eligible) return [0,0];
  const {net,service}=model.calibration;
  if (flatGate) return [net.mean,service.mean];
  const raw=uncalibratedAdvantage(proposal,model);
  return [net.mean+net.slope*(raw[0]-net.predictedMean),
    service.mean+service.slope*(raw[1]-service.predictedMean)];
}

export function chooseLongRepair(proposal,advantage,settings) {
  const [expectedNet,expectedService]=advantage;
  const score=expectedNet+settings.serviceCredit*expectedService;
  const accept=proposal.eligible && !settings.constantOnly && score>settings.hurdle;
  return {plannerId:proposal.plannerId,constantId:proposal.constantId,closureId:proposal.closureId,
    chosenId:accept ? proposal.closureId : proposal.constantId,eligible:proposal.eligible,
    expectedNet,expectedService,score};
}
export function longRepairDecision(proposal,model,options) {
  return chooseLongRepair(proposal,gateAdvantage(proposal,model,options),model.settings);
}
export function inspectLongRepair(obs,menu,model,weights,options) {
  return longRepairDecision(longRepairProposal(closureFrame(obs),menu,weights),model,options);
}
export function makeLongRepairPolicy(model,weights,options) {
  return (obs,menu)=>inspectLongRepair(obs,menu,model,weights,options).chosenId;
}
