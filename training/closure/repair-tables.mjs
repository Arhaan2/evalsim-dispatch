import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {table,signed,count,digits,percentage} from "../fleetweek/render-decisions.mjs";

export function interval(comparison, service=false) {
  const [point, bounds] = service ? [comparison.servicePP, comparison.service95] : [comparison.net, comparison.net95];
  return signed(point,3)+" ["+bounds.map(n=>signed(n,3)).join(", ")+"]";
}
export function section(title, content) {
  return "<details><summary>"+title+"</summary>"+content+"</details>";
}
export function baselineTable(title, rows) {
  return table(title,["Weeks","Count","Credits vs planner","Credits vs constant penalty","On-time pp vs planner","On-time pp vs constant penalty"],
    rows.map(([name,g])=>[name,count(g.weeks),interval(g.comparisons.planner),interval(g.comparisons.flatRisk),
      interval(g.comparisons.planner,true),interval(g.comparisons.flatRisk,true)]));
}

export function registeredTests(all, archive, goals) {
  const tests = [
    ["Fresh earnings vs rolling planner",all.comparisons.planner,false,goals.freshProfit],
    ["Fresh earnings vs constant penalty",all.comparisons.flatRisk,false,goals.freshFlatProfit],
    ["Fresh on-time service vs rolling planner",all.comparisons.planner,true,goals.freshService],
    ["Fresh on-time service vs constant penalty",all.comparisons.flatRisk,true,goals.freshFlatService],
    ["Original double-return earnings vs planner",archive.summary.all.comparisons.planner,false,goals.doubleReturn],
  ];
  if (Object.hasOwn(goals,"freshShortProfit")) {
    tests.unshift(["Fresh earnings vs short-trained default",all.comparisons.shortGate,false,goals.freshShortProfit],
      ["Fresh on-time service vs short-trained default",all.comparisons.shortGate,true,goals.freshShortService]);
  }
  const registered = table(tests.length===7?"Seven registered tests":"Five registered tests",["Comparison","Agent difference [paired 95% interval]","Units","Test"],
    tests.map(([name,c,service,passed])=>[name,interval(c,service),service?"percentage points":"credits/week",passed?"Met":"Missed"]));
  return {tests,registered};
}
export function dispatcherTable(all, labels) {
  return table("All six dispatchers on the fresh weeks",["Dispatcher","Net credits/week","Contracts on time","Empty miles/week"],
    Object.entries(labels).map(([key,name])=>{
      const p=all.policies[key];
      return [name,digits(p.net),percentage(p.onTime),digits(p.emptyMiles)];
    }));
}
export async function writeSampleReport(data, suite, validation, policy, verify) {
  const bank=JSON.parse(await readFile(new URL("validation.json",data),"utf8"));
  const sample = {suite,version:1,split:"validation",policy,
    cases:bank.cases.map(({family,seed,closure,rl})=>({family,seed,closure,...rl})),
    summary:{...validation.summary,durationGroups:validation.durationGroups,byDuration:validation.byDuration}};
  const bytes = JSON.stringify(verify(sample,null,bank))+"\n";
  const sampleFile = new URL("sample-report.json",data);
  if (process.argv.includes("--check")) assert.equal(await readFile(sampleFile,"utf8"),bytes,"sample report differs from the verified release policy");
  else await writeFile(sampleFile,bytes);
}
