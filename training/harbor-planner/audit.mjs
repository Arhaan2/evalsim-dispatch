import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHarborPlanner } from "../../docs/lib/harbor-planner.js";
import { availableActions, createWorld, dispatcher, makeScenario, observe, step, verify, WORLD_VERSION } from "../../docs/lib/world.js";
import { FINAL_TEST, TRAIN, HELD_OUT } from "../protocol.mjs";

function evaluate(cases, makePolicy) {
  let successes = 0, rejections = 0, calls = 0, spend = 0, fulfillment = 0;
  for (const { kind, seed } of cases) {
    const world = createWorld(makeScenario(seed, kind));
    const choose = makePolicy();
    while (!world.done) {
      const observation = observe(world);
      const action = choose(observation);
      assert.ok(availableActions(observation).some((call) => JSON.stringify(call) === JSON.stringify(action)));
      step(world, action);
    }
    const result = verify(world);
    assert.deepEqual(result.violations, []);
    successes += Number(result.success);
    rejections += result.rejectedActions;
    calls += result.toolCalls;
    spend += result.spend;
    fulfillment += result.fulfillmentRate;
  }
  return { cases: cases.length, successes, rejections, success: successes / cases.length,
    toolCalls: calls / cases.length, cost: spend / cases.length, fulfillment: fulfillment / cases.length };
}

const additional = [...TRAIN, ...HELD_OUT].flatMap((kind) => Array.from({length: 100}, (_, i) => ({kind, seed: 87000000 + i})));
const result = { worldVersion: WORLD_VERSION, protocol: "harbor-planner-v1",
  original: evaluate(FINAL_TEST, createHarborPlanner),
  unseenFamilies: evaluate(FINAL_TEST.filter(({kind}) => HELD_OUT.includes(kind)), createHarborPlanner),
  additional: evaluate(additional, createHarborPlanner), additionalDispatcher: evaluate(additional, () => dispatcher) };
const destination = new URL("../../docs/data/harbor-planner.json", import.meta.url);
if (process.argv[2] === "--record") await writeFile(destination, JSON.stringify(result, null, 2) + "\n");
else assert.deepEqual(result, JSON.parse(await readFile(destination, "utf8")));
console.log("Harbor planner verified on " + result.original.cases + " published and " + result.additional.cases + " additional shifts.");
