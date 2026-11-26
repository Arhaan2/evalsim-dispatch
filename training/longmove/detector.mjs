// Every row is a genuine frozen-short-path disagreement. netGain compares one
// forced long move with the short move using the same frozen-short continuation.
export function detectorStats(rows, fitIndex, baseRate) {
  let profitable=0, ties=0, tp=0, switchedTies=0, switchedCostly=0, brier=0, baseBrier=0;
  const ranking=[];
  for (const row of rows) {
    const {probability,switched}=row.predictions[fitIndex];
    if (!(Number.isFinite(probability) && probability>=0 && probability<=1)) throw Error("Invalid win probability");
    const y=Number(row.netGain>0);
    profitable+=y;
    ties+=Number(row.netGain===0);
    if (switched) {
      tp+=y;
      switchedTies+=Number(row.netGain===0);
      switchedCostly+=Number(row.netGain<0);
    }
    ranking.push({probability,y});
    brier+=(probability-y)**2;
    baseBrier+=(baseRate-y)**2;
  }
  // Each equal-score positive/negative pair gets half credit, regardless of input order.
  ranking.sort((a,b)=>a.probability-b.probability);
  let pairs=0, lowerNegatives=0;
  for (let i=0;i<ranking.length;) {
    let end=i, positives=0;
    while(end<ranking.length && ranking[end].probability===ranking[i].probability) positives+=ranking[end++].y;
    const negatives=end-i-positives;
    pairs+=positives*(lowerNegatives+negatives/2);
    lowerNegatives+=negatives;
    i=end;
  }
  const n=rows.length, costly=n-profitable-ties, fp=switchedTies+switchedCostly, switched=tp+fp;
  const defined=profitable>0 && profitable<n;
  return {n,profitable,ties,costly,switched,tp,fp,fn:profitable-tp,tn:n-profitable-fp,switchedTies,switchedCostly,
    precision:switched ? tp/switched : null,recall:profitable ? tp/profitable : null,
    auroc:defined ? pairs/(profitable*(n-profitable)) : null,brier:n ? brier/n : null,baseRate,
    baseBrier:n ? baseBrier/n : null,baseAuroc:defined ? .5 : null};
}

// Conditional on which weeks contain opportunities: resample whole such weeks
// within each market, preserving any dependence among that week's decisions.
export function detectorInterval(rows, baseRate) {
  const strata=new Map();
  for (const row of rows) {
    if (!strata.has(row.family)) strata.set(row.family,new Map());
    const weeks=strata.get(row.family);
    if (!weeks.has(row.seed)) weeks.set(row.seed,[]);
    weeks.get(row.seed).push(row);
  }
  const blocks=Array.from(strata.values(),weeks=>Array.from(weeks.values()));
  const auc=[], gains=[], resamples=2000;
  let rng=9713;
  for (let i=0;i<resamples && rows.length;i++) {
    const sample=[];
    for (const family of blocks) for (let j=0;j<family.length;j++) {
      rng=(Math.imul(1664525,rng)+1013904223)>>>0;
      sample.push(...family[Math.floor((rng/4294967296)*family.length)]);
    }
    const s=detectorStats(sample,0,baseRate);
    if (s.auroc!==null) auc.push(s.auroc);
    gains.push(s.baseBrier-s.brier);
  }
  function bounds(values) {
    if (!values.length) return null;
    values.sort((a,b)=>a-b);
    return [values[Math.floor(.025*(values.length-1))],values[Math.ceil(.975*(values.length-1))]];
  }
  const point=detectorStats(rows,0,baseRate);
  return {weeks:blocks.reduce((n,b)=>n+b.length,0),resamples,validAuroc:auc.length,validBrier:gains.length,
    auroc95:bounds(auc),brierGain:rows.length ? point.baseBrier-point.brier : null,brierGain95:bounds(gains)};
}
