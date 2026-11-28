import assert from "node:assert/strict";

const serves=id=>id.split("|").includes("C");
export function guardEvidence(cases,paths) {
  const lossAccounting={losses101:0,prevented:0,remaining:0,introduced:0,gains101:0,kept:0,surrendered:0,newGains:0};
  const decisions={warnings:0,changedWarnings:0,fit211Only:0,frozen73Only:0,bothAlternatives:0};
  const examples={prevented:null,introduced:null,surrendered:null,newGain:null};
  for(const [j,c] of cases.entries()) {
    const path=paths[j],w=c.warningEpoch;
    assert.deepEqual(path.actions.slice(0,w??10),c.previous.actions.slice(0,w??10));
    if(w!==null) {
      decisions.warnings++;
      const chosen=path.actions[w], previous=c.previous.actions[w];
      if(chosen!==previous) {
        const fit211=chosen===c.fit211.actions[w],frozen73=chosen===c.frozen73.actions[w];
        assert(fit211||frozen73);
        decisions.changedWarnings++;
        decisions[fit211&&frozen73?"bothAlternatives":fit211?"fit211Only":"frozen73Only"]++;
      } else assert.deepEqual(path,c.previous);
    }
    for(const t of [8,9]) {
      const agent=serves(path.actions[t]),previous=serves(c.previous.actions[t]),base=serves(c.frozen73.actions[t]);
      let kind=null;
      if(!previous&&base) {
        lossAccounting.losses101++;
        if(agent){kind="prevented";lossAccounting.prevented++;}else lossAccounting.remaining++;
      } else if(previous&&!base) {
        lossAccounting.gains101++;
        if(!agent){kind="surrendered";lossAccounting.surrendered++;}else lossAccounting.kept++;
      } else if(previous&&!agent){kind="introduced";lossAccounting.introduced++;}
      else if(!previous&&agent){kind="newGain";lossAccounting.newGains++;}
      if(kind&&!examples[kind])examples[kind]={family:c.family,seed:c.seed,closure:c.closure,warningEpoch:w,epoch:t,
        candidate:path,previous:c.previous,frozen73:c.frozen73};
    }
  }
  return {lossAccounting,decisions,examples};
}
