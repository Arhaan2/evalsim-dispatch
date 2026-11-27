export function representativeForks(examples, groups = [e=>e.chosenId===e.longId,e=>e.chosenId!==e.longId]) {
  const result = [];
  for (const inGroup of groups) for (const sign of [1,-1,0]) {
    const bucket = examples.filter(e => inGroup(e) && Math.sign(e.netGain) === sign);
    if (!bucket.length) continue;
    const values = bucket.map(e => e.netGain).sort((a,b) => a-b);
    const median = (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
    result.push(bucket.reduce((a,b) => Math.abs(a.netGain - median) <= Math.abs(b.netGain - median) ? a : b));
  }
  return result;
}
export function decisionCounts(forks) {
  const adopted = forks.filter(f => f.chosenId === f.longId), deferred = forks.filter(f => f.chosenId === f.shortId);
  function outcomes(branches) {
    const wins = branches.filter(f=>f.netGain>0).length, losses = branches.filter(f=>f.netGain<0).length;
    return {wins, ties:branches.length - wins - losses, losses,
      net:branches.length ? branches.reduce((s,f)=>s+f.netGain,0)/branches.length : null,
      servicePP:branches.length ? 10*branches.reduce((s,f)=>s+f.serviceGain,0)/branches.length : null};
  }
  return {eligible:forks.length, switched:adopted.length, deferred:deferred.length,
    outcomes:{adopted:outcomes(adopted), deferred:outcomes(deferred)}};
}
