import assert from "node:assert/strict";
import { TARIFF_PATTERNS, tariffCases, createTariff, observeTariff, stepTariff, verifyTariff } from "../../docs/lib/tariff.js";
import { chooseTariff } from "../../docs/lib/tariff-policy.js";
import { benchmarkTariff, tariffReferences } from "../../docs/lib/tariff-benchmark.js";

export function fitScores(split,model) {
  const rows={};
  for (const config of tariffCases(split)) {
    const state=createTariff(config);
    while (!state.done) stepTariff(state,chooseTariff(observeTariff(state),model));
    const score=verifyTariff(state);
    assert.deepEqual(score.violations,[]);
    const p=TARIFF_PATTERNS[config.family];
    for (const key of ["all",p.stratum+"/"+p.ending]) {
      const g=rows[key]??={shifts:0,netCents:0,bought:0};
      g.shifts++; g.netCents+=score.netCents; g.bought+=Number(score.bought);
    }
  }
  for (const g of Object.values(rows)) g.mean=g.netCents/(100*g.shifts);
  return rows;
}

function acquisition(rows) {
  const groups={};
  for (const row of rows) {
    const p=TARIFF_PATTERNS[row.family];
    for(const context of ["all",p.stratum+"/"+p.ending]) {
      const prices=groups[context]??={};
      const atPrice=prices[row.priceCents]??={};
      for (const [i,name] of ["rl","planner"].entries()) {
        const bought=row.bought[i];
        const yes=Math.round(100*row[name+"Always"]),no=Math.round(100*row[name+"Never"]);
        assert.equal(Math.round(100*row[name]),bought?yes:no);
        const g=atPrice[name]??={shifts:0,bought:0,feeCents:0,buyGainCents:0,skipGainCents:0};
        g.shifts++; g.bought+=Number(bought);
        if (bought) g.feeCents+=row.priceCents;
        g[bought?"buyGainCents":"skipGainCents"]+=yes-no;
      }
    }
  }
  return groups;
}

export async function evaluateSplit(split,weights) {
  const refs=tariffReferences(weights);
  const report=await benchmarkTariff({split,policy:"Variable-price dispatcher",weights,createPolicy:()=>refs.rl});
  const cases=report.cases.map(({actions,net,gross,feePaid,netCents,grossCents,feeCents,reading,...row})=>{
    assert.equal(net,row.rl);
    assert.equal(grossCents-feeCents,netCents);
    assert.equal(feeCents,actions[5]==="buy" ? row.priceCents : 0);
    return row;
  });
  return {summary:report.summary,cases,acquisition:acquisition(cases)};
}

export function assess(splits,margin) {
  const fresh=splits.test.summary, orig=splits.retention.summary.all.references;
  const hotDrops=fresh.byStratumEnding["interrupted-drop"].hot.references.planner.interval95[0]>0;
  const coldReversals=fresh.byStratumEnding.reversal.cold.references.planner.interval95[0]>0;
  const originalDrop=["stochastic","booking","survey"].every(k=>orig[k].interval95[0]>0)
    && ["paid","rally","trust","drift","turns"].every(k=>orig[k].interval95[0]>-margin);
  const positive=fresh.positive;
  const selectivePurchasing=positive.bought>0 && positive.bought<positive.shifts &&
    ["rlNever","rlAlways"].every(k=>positive.references[k].interval95[0]>0);
  return {hotDrops,coldReversals,originalDrop,joint:hotDrops&&coldReversals&&originalDrop,selectivePurchasing};
}
