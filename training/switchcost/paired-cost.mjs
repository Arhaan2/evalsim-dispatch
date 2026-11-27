import {pairedRecall} from "../moverecall/paired-recall.mjs";

// Pair both policies on the same short-path opportunities. Use the exact same
// family/week draws for loss rates and recall. Only strictly negative net is a loss.
export function pairedSwitchCost(rows,index) {
  const result=pairedRecall(rows,index);
  const groups=new Map();
  let oldLosses=0,newLosses=0,addedWins=0,addedLoss=0,droppedWins=0,droppedLoss=0;
  for(const r of rows) {
    const old=r.previous.switched, take=r.predictions[index].switched, loss=r.netGain<0;
    oldLosses+=Number(old&&loss); newLosses+=Number(take&&loss);
    if (old&&!take) {droppedWins+=Math.max(0,r.netGain); droppedLoss+=Math.min(0,r.netGain);}
    if (take&&!old) {addedWins+=Math.max(0,r.netGain); addedLoss+=Math.min(0,r.netGain);}
    if (!groups.has(r.family)) groups.set(r.family,new Map());
    const weeks=groups.get(r.family);
    if (!weeks.has(r.seed)) weeks.set(r.seed,{n:0,old:0,current:0,wins:0,recovered:0});
    const w=weeks.get(r.seed);
    w.n++; w.old+=Number(old&&loss); w.current+=Number(take&&loss);
    w.wins+=Number(r.netGain>0);
    if(r.netGain>0) w.recovered+=Number(take)-Number(old);
  }
  const strata=Array.from(groups.values(),g=>Array.from(g.values()));
  const reductions=[], pairedRecalls=[];
  let rng=9713;
  for(let rep=0;rep<2000 && rows.length;rep++) {
    let n=0,lossChange=0,wins=0,recovered=0;
    for(const g of strata) for(let j=0;j<g.length;j++) {
      rng=(Math.imul(1664525,rng)+1013904223)>>>0;
      const w=g[Math.floor(rng/4294967296*g.length)];
      n+=w.n; lossChange+=w.old-w.current; wins+=w.wins; recovered+=w.recovered;
    }
    reductions.push(lossChange/n);
    if (wins) pairedRecalls.push(recovered/wins);
  }
  function ci(sample) {
    if(!sample.length) return null;
    sample.sort((a,b)=>a-b);
    return [sample[Math.floor(.025*(sample.length-1))],sample[Math.ceil(.975*(sample.length-1))]];
  }
  const ratio=n=>rows.length ? n/rows.length : null;
  return {...result,oldLosses,newLosses,avoidedLosses:result.dropped.costly,addedLosses:result.added.costly,
    oldLossRate:ratio(oldLosses),newLossRate:ratio(newLosses),lossReduction:ratio(oldLosses-newLosses),
    added:{...result.added,winningCredits:addedWins,losingCredits:addedLoss},
    dropped:{...result.dropped,winningCredits:droppedWins,losingCredits:droppedLoss},
    validLoss:reductions.length,validJoint:pairedRecalls.length,loss95:ci(reductions),recall95:ci(pairedRecalls)};
}
