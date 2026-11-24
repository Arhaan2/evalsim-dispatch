import { loadchoiceDecision } from "./loadchoice-policy.js";
import { boardKey, gateKey, sixKey, sevenKey } from "./lastslot-policy.js";

function prefixRow(observation, model) {
  let signs = 0;
  for (let wave = 0; wave < 5; wave++) signs |= Number(observation.history[wave].high) << wave;
  const bulletin = Math.round(10 * observation.history[3].quote.highChance);
  return model.boards[boardKey(observation.history[0].quote)][gateKey(bulletin, signs)];
}

export function waitcostDecision(o, model, priors, mode="optional") {
  const base = loadchoiceDecision(o, priors.loadchoice, priors, mode);
  if (o.slots !== 1 || o.done) return {...base, guard:null};
  if (o.phase === "survey") {
    const row = prefixRow(o, model), advantage = row.delta - o.surveyFee;
    const buy = mode === "always" || (mode !== "never" && advantage > 1e-10);
    return {...base,action:buy ? "buy" : "skip",skipValue:row.skip,
      buyValue:row.skip + advantage,advantage,guard:null};
  }
  if (o.reading == null || o.wave < 5 || o.wave > 6 || base.action !== "pass") return {...base,guard:null};
  const blind = loadchoiceDecision({...o,reading:null},priors.loadchoice,priors);
  if (blind.action !== "accept") return {...base,guard:null};

  const six = sixKey(o.reading, o.wave === 5 ? o.offer.net === o.quote.high : o.history[5].high);
  const index = o.wave === 5 ? six : 16 + sevenKey(six,Math.round(10*o.quote.highChance),o.offer.net === o.quote.high);
  const estimate = prefixRow(o,model).guard[index];
  if (!estimate) return {...base,guard:null};
  const [meanWaitGain,meanDownside,lossProbability] = estimate;
  const score = meanWaitGain - model.penalty*meanDownside, reverted = score <= 0;
  const guard = {baseAction:"pass",blindAction:"accept",meanWaitGain,meanDownside,lossProbability,
    penalty:model.penalty,score,reverted};
  return {...base,action:reverted ? "accept" : "pass",bookValue:o.offer.net,
    waitValue:o.offer.net+score,advantage:-score,guard};
}

export const chooseWaitcost = (o,model,priors,mode) => waitcostDecision(o,model,priors,mode).action;
