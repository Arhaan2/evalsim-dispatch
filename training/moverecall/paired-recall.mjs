// A long move wins only if it earns strictly more than short through Friday,
// with the same short continuation. A tie remains a negative classifier label.
function outcome(rows) {
  const wins=rows.filter(r=>r.netGain>0).length, ties=rows.filter(r=>r.netGain===0).length;
  return {n:rows.length,wins,ties,costly:rows.length-wins-ties,
    credits:rows.reduce((s,r)=>s+r.netGain,0),contracts:rows.reduce((s,r)=>s+r.serviceGain,0)};
}
function ratio(n,d) {return d ? n/d : null;}
function bounds(xs) {
  if (!xs.length) return null;
  xs.sort((a,b)=>a-b);
  return [xs[Math.floor(.025*(xs.length-1))],xs[Math.ceil(.975*(xs.length-1))]];
}
export function pairedRecall(rows,index) {
  const groups=new Map(), added=[], dropped=[];
  let bothCaught=0,recovered=0,newlyLost=0,missedByBoth=0,offered=0,oldOffered=0;
  for (const row of rows) {
    const old=row.previous.switched, take=row.predictions[index].switched, win=row.netGain>0;
    offered+=Number(take); oldOffered+=Number(old);
    if(take&&!old) added.push(row);
    if(old&&!take) dropped.push(row);
    if (win) {
      if (old && take) bothCaught++;
      else if (take) recovered++;
      else if (old) newlyLost++;
      else missedByBoth++;
    }
    if (!groups.has(row.family)) groups.set(row.family,new Map());
    const weeks=groups.get(row.family);
    if(!weeks.has(row.seed)) weeks.set(row.seed,{wins:0,old:0,take:0});
    const week=weeks.get(row.seed);
    week.wins+=Number(win); week.old+=Number(win&&old); week.take+=Number(win&&take);
  }
  const strata=Array.from(groups.values(),s=>Array.from(s.values()));
  const deltas=[], levels=[], oldLevels=[], resamples=2000;
  let rng=9713;
  for (let rep=0;rep<resamples && rows.length;rep++) {
    let wins=0, old=0, take=0;
    for(const g of strata) for(let i=0;i<g.length;i++) {
      rng=(Math.imul(1664525,rng)+1013904223)>>>0;
      const w=g[Math.floor(rng/4294967296*g.length)];
      wins+=w.wins; old+=w.old; take+=w.take;
    }
    if (wins) {deltas.push((take-old)/wins);levels.push(take/wins);oldLevels.push(old/wins);}
  }
  const profitable=bothCaught+recovered+newlyLost+missedByBoth,previousMisses=recovered+missedByBoth;
  return {n:rows.length,profitable,previousMisses,bothCaught,recovered,newlyLost,missedByBoth,
    recoveryRate:ratio(recovered,previousMisses),recall:ratio(bothCaught+recovered,profitable),
    previousRecall:ratio(bothCaught+newlyLost,profitable),recallDifference:ratio(recovered-newlyLost,profitable),
    precision:ratio(bothCaught+recovered,offered),previousPrecision:ratio(bothCaught+newlyLost,oldOffered),
    added:outcome(added),dropped:outcome(dropped),weeks:strata.reduce((s,g)=>s+g.length,0),resamples,
    validRecall:deltas.length,recall95:bounds(deltas),newRecall95:bounds(levels),previousRecall95:bounds(oldLevels)};
}
