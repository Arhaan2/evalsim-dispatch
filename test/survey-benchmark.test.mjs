import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { benchmarkSurvey, surveyReferences, surveyWeights, verifySurveyReport } from "../docs/lib/survey-benchmark.js";
import { verifyRallyReport } from "../docs/lib/rally-benchmark.js";
import { warningAuc, aucInterval } from "../training/survey/evaluate.mjs";

const releases = await Promise.all(["survey", "rally", "trust", "closes", "drift", "turns"].map(async n =>
  JSON.parse(await readFile(new URL("../docs/data/" + n + "/results.json", import.meta.url)))));
const [study] = releases;
const weights = surveyWeights(...releases);
const refs = surveyReferences(weights);

test("the external Survey benchmark reproduces its case scores and primary paired intervals", async () => {
  for (const [split, result] of [["test",study],["retention",study.guard],["archive",study.archive]]) {
    const report = await benchmarkSurvey({ split, weights, policy:"outside", createPolicy:() => refs.rl });
    assert.equal(report.cases.length,result.cases.length);
    for (const [i,row] of report.cases.entries()) {
      const published = result.cases[i];
      assert.equal(row.family,published.family);
      assert.equal(row.seed,published.seed);
      assert.equal(row.actions.length,8);
      assert.equal(row.net,published.rl);
      for (const k of Object.keys(refs)) assert.equal(row[k],published[k],k);
    }
    for (const [stratum,endings] of Object.entries(report.summary.byStratumEnding)) {
      for (const [ending,g] of Object.entries(endings)) {
        const published = result.comparisons.byStratumEnding[stratum][ending];
        assert.equal(g.shifts,published.count);
        for (const [key,suffix] of [["stochastic","Stochastic"],["rally","Rally"],["always","Always"],["never","Never"]]) {
          assert.deepEqual(g.references[key].interval95,published["rlMinus"+suffix].interval95);
        }
      }
    }
    if (split === "retention") {
      await verifySurveyReport(report,weights);
      await assert.rejects(verifyRallyReport(report,{}),/suite version/);
      report.cases[0].net++;
      await assert.rejects(verifySurveyReport(report,weights),/differ/);
    }
  }
});

test("misleading-signal discrimination gives half credit to ties and keeps matched events in a bootstrap cluster", () => {
  const rows=[{seed:1,wrong:0,risk:0.1},{seed:1,wrong:1,risk:0.5},{seed:2,wrong:0,risk:0.5},{seed:2,wrong:1,risk:0.8}];
  assert.equal(warningAuc(rows),0.875);
  assert.deepEqual(aucInterval(rows),[0.875,1]);
  assert.equal(warningAuc(rows.map(r => ({...r,risk:0.5}))),0.5);
  for (const diagnostic of [study.diagnostic,study.archive.diagnostic]) {
    const {all,hotSignal,coldSignal,neutralCount} = diagnostic.warning;
    assert.equal(all.count+neutralCount,8192);
    assert.equal(hotSignal.count+coldSignal.count,all.count);
    assert.equal(all.misleadingCount+all.alignedCount,all.count);
    assert.equal(diagnostic.warningPass,all.gainVsChance.interval95[0]>0 && all.auc95[0]>0.5);
    assert.equal(diagnostic.byWave[0].forecasts.rl.accuracy,0.5);
  }
});
