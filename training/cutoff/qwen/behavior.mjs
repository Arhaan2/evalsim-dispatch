// These counts describe completed physical episodes. One paired success requires different
// express destinations, a preceding public inspection on both twins, and two clean ledgers.
export function behavior(evaluations) {
  return Object.fromEntries(Object.entries(evaluations).map(([name, replicas]) => [name, replicas.map(rows => {
    const uncertain = new Map(), urgent = rows.filter(row => row.family === 'urgent');
    for (const row of rows.filter(row => row.family === 'uncertain')) {
      if (!uncertain.has(row.seed)) uncertain.set(row.seed, []);
      uncertain.get(row.seed).push(row);
    }
    let inspectedBothAndAdapted = 0, succeededOnBoth = 0;
    for (const twins of uncertain.values()) {
      const moves = twins.map(row => row.decisions.map(d => d.action));
      const express = moves.map(path => path.findIndex(id => id.startsWith('express-')));
      const checkedFirst = moves.every((path, i) => path.indexOf('inspect') >= 0 && path.indexOf('inspect') < express[i]);
      const both = twins.every(t => t.metrics.success);
      if (both) succeededOnBoth++;
      if (both && checkedFirst && moves[0][express[0]] !== moves[1][express[1]]) inspectedBothAndAdapted++;
    }
    return { uncertainPairs: uncertain.size, succeededOnBoth, inspectedBothAndAdapted,
      urgentCases: urgent.length, urgentImmediateExpress: urgent.filter(row => row.decisions[0].action.startsWith('express-')).length };
  })]));
}

export function callCounts(training, evaluations) {
  const calls = rows => rows.reduce((n, p) => n + p.metrics.calls, 0);
  return { demonstrations: training.map(r => calls(r.demonstrations)),
    onPolicyRL: training.map(r => calls(r.groups.flat())), test: Object.fromEntries(Object.entries(evaluations)
      .map(([name, replicas]) => [name, replicas.map(calls)])) };
}
