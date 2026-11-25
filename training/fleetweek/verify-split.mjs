// Recheck published score tables using separate week pairing and ledger arithmetic.
import assert from "node:assert/strict";
import {average, paired} from "./audit-helpers.mjs";

function verifyScores(rows, result, references) {
  assert.equal(result.weeks, rows.length);
  for (const key of ["agent", ...references]) assert.deepEqual(result.policies[key], average(rows,key));
  for (const key of references) assert.deepEqual(result.comparisons[key], paired(rows,key));
  const comparison = result.comparisons.planner;
  assert.equal(result.earnsMoreThanPlanner, comparison.net95[0] > 0);
  assert.equal(result.matchesPlannerService, comparison.servicePP >= 0 && comparison.service95[0] >= 0);
  assert.equal(result.beatsPlanner, result.earnsMoreThanPlanner && result.matchesPlannerService);
}

export function verifyFleetSplit(rows, allFits, report, references, families, seeds) {
  const {summary,fits,versusPlanner}=report;
  for (const ref of Object.keys(versusPlanner)) {
    assert(references.includes(ref));
    assert.deepEqual(versusPlanner[ref], paired(rows.map(r=>({...r,agent:r[ref]})),"planner"));
  }
  for (const name of references.filter(name=>name!=="planner")) assert(Object.hasOwn(versusPlanner,name));
  verifyScores(rows,summary.all,references);
  assert.deepEqual(Object.keys(summary.byFamily),families);
  for (const family of families) verifyScores(rows.filter(r=>r.family===family),summary.byFamily[family],references);
  assert.deepEqual(fits.map(f=>f.seed),seeds);
  for (const [i,fit] of fits.entries()) {
    const sample=rows.map((r,j)=>({...r,agent:allFits[j][i]}));
    const stats=average(sample,"agent");
    assert.equal(fit.net,stats.net);
    assert.equal(fit.onTime,stats.onTime);
    assert.deepEqual(fit.planner,paired(sample,"planner"));
  }
}
