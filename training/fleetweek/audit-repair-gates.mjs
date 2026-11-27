import assert from "node:assert/strict";

export function checkConstantGate(group) {
  const short=group.comparisons.shortGate;
  assert.equal(group.earnsMoreThanShortGate,short.net95[0]>0);
  assert.equal(group.matchesShortGateService,short.servicePP>=0 && short.service95[0]>=0);
  assert.equal(group.beatsShortGate,group.earnsMoreThanShortGate && group.matchesShortGateService);
  const c = group.comparisons.flatRisk;
  assert.equal(group.earnsMoreThanFlatRisk,c.net95[0]>0);
  assert.equal(group.matchesFlatRiskService,c.service95[0]>=0 && c.servicePP>=0);
  assert.equal(group.beatsFlatRisk,group.earnsMoreThanFlatRisk && group.matchesFlatRiskService);
}
export function medianForks(forks) {
  const out = [];
  for (const defer of [false,true]) for (const sign of [1,-1,0]) {
    const block = forks.filter(f=>(f.chosenId===f.shortId) === defer && Math.sign(f.netGain)===sign);
    if (!block.length) continue;
    const sorted = block.map(f=>f.netGain).sort((a,b)=>a-b), n = sorted.length;
    const mid = (sorted[Math.floor(n/2)] + sorted[Math.floor((n-1)/2)])/2;
    const nearest = Math.min(...sorted.map(v=>Math.abs(v-mid)));
    out.push(block.find(f=>Math.abs(f.netGain-mid)===nearest));
  }
  return out;
}
export function counts(forks) {
  const deferred = forks.reduce((n,f)=>n+Number(f.chosenId===f.shortId),0);
  function outcomes(wasAdopted) {
    let wins=0, ties=0, losses=0, totalNet=0, totalServed=0;
    for (const f of forks) {
      if ((f.chosenId===f.longId)!==wasAdopted) continue;
      wins+=Number(f.netGain>0); ties+=Number(f.netGain===0); losses+=Number(f.netGain<0);
      totalNet+=f.netGain; totalServed+=f.serviceGain;
    }
    const n=wins+ties+losses;
    return {wins,ties,losses,net:n ? totalNet/n : null,servicePP:n ? 10*totalServed/n : null};
  }
  return {eligible:forks.length,deferred,switched:forks.length-deferred,
    outcomes:{adopted:outcomes(true),deferred:outcomes(false)}};
}
