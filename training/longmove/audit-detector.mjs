// Independently compute discrimination with explicit win/nonwin pairs. Decisions
// used as inputs have already been regenerated on the historical short path.
function discrimination(rows,index) {
  const wins=[], nonwins=[];
  for (const r of rows) (r.netGain>0 ? wins : nonwins).push(r.predictions[index].probability);
  if (!wins.length || !nonwins.length) return null;
  let credit=0;
  for (const p of wins) for (const q of nonwins) credit+=p===q ? .5 : Number(p>q);
  return credit/(wins.length*nonwins.length);
}
function errors(rows,index,rate) {
  if (!rows.length) return {brier:null,baseBrier:null};
  let fitted=0,constant=0;
  for (const r of rows) {
    const y=r.netGain>0 ? 1 : 0, delta=r.predictions[index].probability-y;
    fitted+=delta*delta;
    constant+=(rate-y)*(rate-y);
  }
  return {brier:fitted/rows.length,baseBrier:constant/rows.length};
}
export function checkDetectorRows(rows,index,baseRate) {
  const selected=rows.filter(r=>r.predictions[index].switched), skipped=rows.filter(r=>!r.predictions[index].switched);
  const count=(list,predicate)=>list.filter(r=>predicate(r.netGain)).length;
  const tp=count(selected,g=>g>0), fp=count(selected,g=>g<=0), tn=count(skipped,g=>g<=0), fn=count(skipped,g=>g>0);
  const auroc=discrimination(rows,index);
  return {n:rows.length,profitable:tp+fn,ties:count(rows,g=>g===0),costly:count(rows,g=>g<0),
    switched:selected.length,tp,fp,fn,tn,switchedTies:count(selected,g=>g===0),switchedCostly:count(selected,g=>g<0),
    precision:tp+fp ? tp/(tp+fp) : null,recall:tp+fn ? tp/(tp+fn) : null,auroc,
    ...errors(rows,index,baseRate),baseRate,baseAuroc:auroc===null ? null : .5};
}
export function checkDetectorInterval(rows,baseRate) {
  const groups = [...Map.groupBy(rows,r=>r.family).values()].map(f=>[...Map.groupBy(f,r=>r.seed).values()]);
  const aus=[], delta=[];
  const point=errors(rows,0,baseRate);
  let state=9713;
  for (let i=0;i<2000 && rows.length;i++) {
    const sample=groups.flatMap(weeks=>Array.from({length:weeks.length},()=>{
      state=(1013904223+Math.imul(state,1664525))>>>0;
      return weeks[Math.floor(weeks.length*state/2**32)];
    }).flat());
    const auc=discrimination(sample,0), e=errors(sample,0,baseRate);
    if (auc!==null) aus.push(auc);
    delta.push(e.baseBrier-e.brier);
  }
  function interval(data) {
    if (!data.length) return null;
    const sorted=data.toSorted((a,b)=>a-b), end=sorted.length-1;
    return [sorted[Math.floor(.025*end)],sorted[Math.ceil(.975*end)]];
  }
  return {weeks:groups.flat().length,resamples:2000,validAuroc:aus.length,validBrier:delta.length,
    auroc95:interval(aus),brierGain:rows.length ? point.baseBrier-point.brier : null,brierGain95:interval(delta)};
}
