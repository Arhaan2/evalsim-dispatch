// Estimate the reward distribution of the long move on an observed disagreement.
// Next-board features enumerate the public menu distribution, never the realized tape.
import {FLEET_PAIRS,fleetPairIndex,fleetWeekBoardScenarios} from "./fleetweek.js";
import {fleetWeekHubProjection} from "./fleetweek-planner.js";
import {closureActions,closureProbabilities} from "./closure-world.js";
import {closureFrame} from "./closure-planner.js";
import {shortDefaultProposal} from "./shortdefault-policy.js";

const menuValues=new WeakMap();
function immediate(menu) {
  if (!menuValues.has(menu)) {
    let best=-Infinity,canServe=0;
    for (const a of menu) {best=Math.max(best,a.net);canServe=Math.max(canServe,a.served);}
    menuValues.set(menu,[canServe,best]);
  }
  return menuValues.get(menu);
}

const conditioned=new WeakMap();
function nextBoardValues(frame) {
  if (conditioned.has(frame)) return conditioned.get(frame);
  const {obs}=frame,next=obs.epoch+1,dc=obs.incident.depot;
  const closed=closureProbabilities(obs)[next],forecast=fleetWeekHubProjection(obs)[next];
  const values=FLEET_PAIRS.map(pos=>{
    let cover=0,earn=0;
    for (const b of fleetWeekBoardScenarios(next)) {
      const mass=b.weight*(.68*forecast[b.hub]+.21*Number(obs.hub===b.hub)+.11/3);
      const board={orders:b.orders,positions:pos};
      const open=immediate(closureActions(board));
      const shut=immediate(closureActions({...board,incident:{status:"closed",depot:dc}}));
      cover+=mass*((1-closed)*open[0]+closed*shut[0]);
      earn+=mass*((1-closed)*open[1]+closed*shut[1]);
    }
    return [cover,earn];
  });
  conditioned.set(frame,values);
  return values;
}
export function longMoveProposal(frame,menu,weights,prepared) {
  const p=shortDefaultProposal(frame,menu,weights,prepared);
  if (!p.eligible) return p;
  const values=nextBoardValues(frame);
  const after=id=>values[fleetPairIndex(menu.find(a=>a.id===id).positions)];
  const s=after(p.shortId),l=after(p.longId);
  return {...p,x:[...p.x,...s,...l,l[0]-s[0],l[1]-s[1]]};
}
export function treeValue(node,x) {
  while (node.value===undefined) node=x[node.feature]<=node.cut ? node.left : node.right;
  return node.value;
}
export function rawHead(head,x) {
  let estimate=head.base;
  for (const tree of head.trees) estimate+=head.rate*treeValue(tree,x);
  return estimate;
}
export const headNames=["win","gain","downside","service"];
export function longMoveEstimates(p,model,{flatGate=false}={}) {
  if (!p.eligible) return {winProbability:null,gainIfWin:null,lossIfNonwin:null,expectedNet:0,expectedService:0};
  const [prob,gain,loss,expectedService]=headNames.map(name=>{
    const cal=model.calibration[name];
    return flatGate ? cal.mean : cal.mean+cal.slope*(rawHead(model.heads[name],p.x)-cal.predictedMean);
  });
  const winProbability=Math.max(.005,Math.min(.995,prob)),gainIfWin=Math.max(0,gain),lossIfNonwin=Math.max(0,loss);
  const expectedNet=winProbability*gainIfWin-(1-winProbability)*lossIfNonwin;
  return {winProbability,gainIfWin,lossIfNonwin,expectedNet,expectedService};
}
export function chooseLongMove(p,estimates,settings) {
  const {winProbability,expectedNet,expectedService}=estimates;
  const score=expectedNet+settings.serviceCredit*expectedService;
  const take=p.eligible && !settings.shortOnly && winProbability>=settings.minWin &&
    expectedNet>settings.hurdle && score>settings.hurdle;
  return {plannerId:p.plannerId,constantId:p.constantId,closureId:p.closureId,longId:p.longId,
    shortId:p.shortId,eligible:p.eligible,chosenId:take ? p.longId : p.shortId,score,...estimates};
}
export function longMoveDecision(p,model,options) {
  return chooseLongMove(p,longMoveEstimates(p,model,options),model.settings);
}
export function inspectLongMove(obs,menu,model,weights,options) {
  return longMoveDecision(longMoveProposal(closureFrame(obs),menu,weights),model,options);
}
export function makeLongMovePolicy(model,weights,options) {
  return (obs,menu)=>inspectLongMove(obs,menu,model,weights,options).chosenId;
}
