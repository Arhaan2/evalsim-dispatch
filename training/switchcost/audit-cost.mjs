import {checkPairedRecall} from "../moverecall/audit-recall.mjs";

// Draw original rows by family and week, independently of the scorer's
// compressed counts. Apply both rival switches to the same counterfactual label.
export function checkCostComparison(rows,index) {
  const parent=checkPairedRecall(rows,index);
  const old=r=>r.previous.switched, take=r=>r.predictions[index].switched;
  const dropped=rows.filter(r=>old(r)&&!take(r)), added=rows.filter(r=>!old(r)&&take(r));
  const losses=rs=>rs.filter(r=>r.netGain<0).length;
  const oldLosses=losses(rows.filter(old)),newLosses=losses(rows.filter(take));
  function severity(rs) {
    const sum=xs=>xs.reduce((s,r)=>s+r.netGain,0);
    return {winningCredits:sum(rs.filter(r=>r.netGain>0)),losingCredits:sum(rs.filter(r=>r.netGain<0))};
  }
  const bySchedule=[...Map.groupBy(rows,r=>r.family).values()].map(g=>[...Map.groupBy(g,r=>r.seed).values()]);
  let state=9713,joint=0;
  const values=[];
  for(let b=0;b<2000 && rows.length;b++) {
    const sample=bySchedule.flatMap(weeks=>Array.from({length:weeks.length},()=>{
      state=(Math.imul(1664525,state)+1013904223)>>>0;
      return weeks[Math.floor(weeks.length*(state/2**32))];
    }).flat());
    values.push((losses(sample.filter(old))-losses(sample.filter(take)))/sample.length);
    joint+=Number(sample.some(r=>r.netGain>0));
  }
  values.sort((a,b)=>a-b);
  const n=rows.length, end=values.length-1;
  return {...parent,oldLosses,newLosses,avoidedLosses:losses(dropped),addedLosses:losses(added),
    oldLossRate:n?oldLosses/n:null,newLossRate:n?newLosses/n:null,lossReduction:n?(oldLosses-newLosses)/n:null,
    added:{...parent.added,...severity(added)},dropped:{...parent.dropped,...severity(dropped)},
    validLoss:values.length,validJoint:joint,loss95:values.length ? [values[Math.floor(.025*end)],values[Math.ceil(.975*end)]] : null};
}
