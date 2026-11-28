// Each half-day issues one distinct signed contract on the shared immutable tape.
export const delivered = id => id.split("|").includes("C");
export const fridayRounds = [8,9];

export function contractComparison(cases,other) {
  const byEpoch = Array.from({length:10},()=>({saved:0,lost:0,bothServed:0,bothMissed:0}));
  for (const c of cases) {
    for (let t=0;t<10;t++) {
      const learned=delivered(c.rl.actions[t]), baseline=delivered(c[other].actions[t]);
      const key=learned ? (baseline?"bothServed":"saved") : (baseline?"lost":"bothMissed");
      byEpoch[t][key]++;
    }
  }
  function total(key,rounds) {return rounds.reduce((s,row)=>s+row[key],0);}
  const saved=total("saved",byEpoch), lost=total("lost",byEpoch);
  return {saved,lost,net:saved-lost,fridaySaved:total("saved",byEpoch.slice(8)),
    fridayLost:total("lost",byEpoch.slice(8)),byEpoch};
}

export function primaryGoals(test) {
  const fit73=test.comparisons.previous, planner=test.comparisons.planner;
  const goals={deliveriesFit73:fit73.service95[0]>0,profitFit73:fit73.net95[0]>0,
    deliveriesPlanner:planner.service95[0]>0,profitPlanner:planner.net95[0]>0};
  return {...goals,joint:Object.values(goals).every(Boolean)};
}

export function positioningCounts(cases) {
  const group=()=>({weeks:0,netCredits:0,emptyMore:0,emptyEqual:0,emptyFewer:0,atWarningSaved:0,atWarningLost:0,
    afterSaved:0,afterLost:0,fridaySaved:0,fridayLost:0});
  const groups={all:group(),differentPlacement:group(),swappedTrucks:group(),samePositions:group(),unchanged:group()};
  const emptyLegs=id=>id.split("|").filter(code=>code.startsWith("E")).length;
  for(const {warningEpoch:t,warningDestinations:dest,rl,previous} of cases) {
    if(t===null)continue;
    const move=rl.actions[t], parent=previous.actions[t], [a,b]=dest.rl, [x,y]=dest.previous;
    const key=move===parent ? "unchanged" : a===x&&b===y ? "samePositions" : a===y&&b===x ? "swappedTrucks" : "differentPlacement";
    const gap=emptyLegs(move)-emptyLegs(parent);
    for(const g of [groups.all,groups[key]]) {
      g.weeks++;g.netCredits+=rl.ledger.net-previous.ledger.net;
      g[gap>0?"emptyMore":gap<0?"emptyFewer":"emptyEqual"]++;
      for(let epoch=t;epoch<10;epoch++) {
        const diff=Number(delivered(rl.actions[epoch]))-Number(delivered(previous.actions[epoch]));
        if(!diff)continue;
        const outcome=diff>0?"Saved":"Lost";
        g[(epoch===t?"atWarning":"after")+outcome]++;
        if(epoch>=8)g["friday"+outcome]++;
      }
    }
  }
  return groups;
}
