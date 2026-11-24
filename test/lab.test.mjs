import assert from "node:assert/strict";
import test from "node:test";
import { noCheck, planner, replayCase, runCase } from "../docs/lib/lab.js";

test("external policies operate on public data and CLI-compatible traces reproduce exactly", async () => {
  const observations = [];
  const record = await runCase({seed:42,split:"test"}, async (obs, calls) => {
    assert.equal(obs.initialStock, undefined);
    assert.equal(obs.variant, undefined);
    assert.ok(calls.every(call => typeof call.id === "string"));
    observations.push(obs);
    return planner(obs);
  });
  assert.equal(record.score.success, true);
  assert.deepEqual(replayCase(JSON.parse(JSON.stringify(record))).score, record.score);
  assert.equal(observations[0].yards[0].confirmed, false);
  const partial = { ...record, complete:false, score:null, actions:record.actions.slice(0, 1) };
  assert.equal(replayCase(partial).complete, false);
  assert.throws(() => replayCase({...record, actions:record.actions.slice(0, 1)}), /completion/);
  assert.throws(() => replayCase({...record, score:{...record.score, calls:99}}), /score/);
  assert.throws(() => replayCase({...record, version:"unknown"}), /version|requires/);
  await assert.rejects(runCase({seed:42}, () => "invented-action"), /unavailable/);
});

test("the public planner solves both hidden inventories and no-check encounters a tradeoff", async () => {
  const configs = [0,1].map(variant => ({seed:42,variant}));
  const results = await Promise.all(configs.map(config => runCase(config, planner)));
  assert.ok(results.every(r => r.score.success));
  assert.ok(results.every(r => r.actions[0] === "inspect"));
  assert.notEqual(results[0].actions[1], results[1].actions[1]);
  const blind = await Promise.all(configs.map(config => runCase(config, noCheck)));
  assert.equal(blind.filter(r => r.score.success).length, 1);
});
