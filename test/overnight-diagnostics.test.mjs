import test from "node:test";
import assert from "node:assert/strict";
import {runFleetWeek} from "../docs/lib/fleetweek.js";
import {chooseFleetPlanner} from "../docs/lib/fleetweek-planner.js";
import {replayFleetActions} from "../docs/lib/fleetweek-benchmark.js";
import {removeOvernightEmpty} from "../docs/lib/overnight-benchmark.js";
import {nightBranches,summarizeNights} from "../training/overnight/diagnostics.mjs";

test("matched forks keep signed trucks, apply intervention once, and recover Friday's net ledger",()=>{
  const config={family:"steady-market",seed:104};
  const {actions,ledger}=runFleetWeek(config,chooseFleetPlanner);
  const row={...config,rl:{actions,ledger},...nightBranches(config,{actions,ledger},chooseFleetPlanner)};
  assert.equal(row.overrides.length,0);
  assert(row.branches.length>0);
  for (const [epoch,chosen,alternative,suffix,net,served] of row.branches) {
    assert([1,3,5,7].includes(epoch));
    assert.notEqual(chosen,alternative);
    assert.equal(chosen.replace(/E[012]/g,"W"),alternative.replace(/E[012]/g,"W"));
    assert.equal(suffix[0],alternative);
    const result=replayFleetActions(config,[...actions.slice(0,epoch),...suffix]);
    assert.equal(result.net,net);
    assert.equal(result.served,served);
  }
  const stats=summarizeNights([row]);
  assert.equal(stats.eligible,stats.move.nights+stats.stay.nights);
  assert.equal(stats.nights,4);
});
test("no-empty control keeps AM, Friday close and indexed freight intact",()=>{
  assert.equal(removeOvernightEmpty("S0|E1",1),"S0|W");
  assert.equal(removeOvernightEmpty("E0|E1",7),"W|W");
  assert.equal(removeOvernightEmpty("S1|C",3),"S1|C");
  assert.equal(removeOvernightEmpty("E1|S0",8),"E1|S0");
  assert.equal(removeOvernightEmpty("S0|E1",9),"S0|E1");
});
