// Re-evaluate treatment changes and resample the actual grouped records. This
// intentionally does not use the scorer's compressed cluster or outcome counts.
export function checkPairedRecall(rows,index) {
  const win=rows.filter(r=>r.netGain>0);
  const now=r=>r.predictions[index].switched, old=r=>r.previous.switched;
  const add=rows.filter(r=>now(r)&&!old(r)), drop=rows.filter(r=>!now(r)&&old(r));
  const ratio=(n,d)=>d ? n/d : null;
  const count=(xs,p)=>xs.reduce((n,r)=>n+Number(p(r)),0);
  const caught=count(win,now), prev=count(win,old), both=count(win,r=>now(r)&&old(r));
  function signTotals(xs) {
    return {n:xs.length,wins:count(xs,r=>r.netGain>0),ties:count(xs,r=>r.netGain===0),costly:count(xs,r=>r.netGain<0),
      credits:xs.map(r=>r.netGain).reduce((a,b)=>a+b,0),contracts:xs.map(r=>r.serviceGain).reduce((a,b)=>a+b,0)};
  }
  const strata=[...Map.groupBy(rows,r=>r.family).values()].map(block=>[...Map.groupBy(block,r=>r.seed).values()]);
  let state=9713;
  const deltas=[], previousLevels=[], newLevels=[];
  for (let rep=0;rep<2000 && strata.length;rep++) {
    const sample=strata.flatMap(weeks=>Array.from({length:weeks.length},()=>{
      state=(1013904223+Math.imul(1664525,state))>>>0;
      return weeks[Math.floor(weeks.length*state/(2**32))];
    }).flat());
    const positive=sample.filter(r=>r.netGain>0);
    if (!positive.length) continue;
    const newHits=count(positive,now), oldHits=count(positive,old);
    previousLevels.push(oldHits/positive.length); newLevels.push(newHits/positive.length);
    deltas.push((newHits-oldHits)/positive.length);
  }
  function interval(xs) {
    if (!xs.length) return null;
    const sorted=xs.toSorted((a,b)=>a-b), end=xs.length-1;
    return [sorted[Math.floor(end*.025)],sorted[Math.ceil(end*.975)]];
  }
  return {n:rows.length,profitable:win.length,previousMisses:win.length-prev,bothCaught:both,recovered:caught-both,
    newlyLost:prev-both,missedByBoth:win.length-prev-caught+both,recoveryRate:ratio(caught-both,win.length-prev),
    recall:ratio(caught,win.length),previousRecall:ratio(prev,win.length),recallDifference:ratio(caught-prev,win.length),
    precision:ratio(caught,count(rows,now)),previousPrecision:ratio(prev,count(rows,old)),added:signTotals(add),dropped:signTotals(drop),
    weeks:strata.flat().length,resamples:2000,validRecall:deltas.length,recall95:interval(deltas),
    newRecall95:interval(newLevels),previousRecall95:interval(previousLevels)};
}
