// Compare the two released learned dispatchers on the exact public board.
// Each old head estimates closure-action minus constant-action advantage. Flip
// that direction when the long-trained policy is the one choosing the constant.
import {closureFrame} from "./closure-planner.js";
import {chooseLongRepair,gateAdvantage,longRepairProposal} from "./longrepair-policy.js";

export function shortDefaultProposal(frame,menu,weights,prepared) {
  const original=longRepairProposal(frame,menu,weights,prepared);
  const short=gateAdvantage(original,weights.short), long=gateAdvantage(original,weights.long);
  const shortId=chooseLongRepair(original,short,weights.short.settings).chosenId;
  const longId=chooseLongRepair(original,long,weights.long.settings).chosenId;
  const eligible=shortId!==longId;
  const ids={plannerId:original.plannerId,constantId:original.constantId,closureId:original.closureId,
    shortId,longId,eligible};
  if (!eligible) return {...ids,x:null,priorNet:0,priorService:0};
  const direction=longId===original.closureId ? 1 : -1;
  const x=[1,...original.x.slice(1).map(v=>direction*v),direction,
    ...short.map(v=>direction*v),...long.map(v=>direction*v)];
  return {...ids,x,priorNet:direction*(short[0]+long[0])/2,priorService:direction*(short[1]+long[1])/2};
}

export function chooseShortDefault(proposal,advantage,settings) {
  const [expectedNet,expectedService]=advantage;
  const score=expectedNet+settings.serviceCredit*expectedService;
  const take=proposal.eligible && !settings.shortOnly && expectedNet>settings.hurdle && score>settings.hurdle;
  return {plannerId:proposal.plannerId,constantId:proposal.constantId,closureId:proposal.closureId,
    shortId:proposal.shortId,longId:proposal.longId,eligible:proposal.eligible,
    chosenId:take ? proposal.longId : proposal.shortId,expectedNet,expectedService,score};
}

export function shortDefaultDecision(proposal,model,options) {
  return chooseShortDefault(proposal,gateAdvantage(proposal,model,options),model.settings);
}

export function inspectShortDefault(obs,menu,model,weights,options) {
  return shortDefaultDecision(shortDefaultProposal(closureFrame(obs),menu,weights),model,options);
}

export function makeShortDefaultPolicy(model,weights,options) {
  return (obs,menu)=>inspectShortDefault(obs,menu,model,weights,options).chosenId;
}
