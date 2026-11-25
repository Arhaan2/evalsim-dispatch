import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {createFleetWeek} from "../../docs/lib/fleetweek.js";
import {replayFleetActions} from "../../docs/lib/fleetweek-benchmark.js";
import {DECISION_MS, fleetLedger} from "../../docs/lib/fleetweek-study.js";
export const hash = data => createHash("sha256").update(data).digest("hex");
export async function artifact(dir, mode, name, object) {
  const url = new URL(name, dir);
  const bytes = JSON.stringify(object) + "\n";
  if (mode === "--check") assert.equal(hash(await readFile(url)), hash(bytes), name + " differs from release");
  else await writeFile(url, bytes);
  return hash(bytes);
}

export async function legacyCheckpoint(dir, study) {
  const metadata = JSON.parse(await readFile(new URL("../" + study + "/results.json", dir), "utf8"));
  const bytes = await readFile(new URL("../" + study + "/model-13.json", dir));
  assert.equal(hash(bytes), metadata.weightHashes[13], study + " baseline digest");
  return {checkpoint: JSON.parse(bytes), hash: hash(bytes)};
}

export function score(config, policy) {
  const week = createFleetWeek(config);
  const actions = [];
  while (!week.done) {
    const obs = week.observe(), legal = week.legalActions();
    const start = performance.now();
    const id = policy(obs, legal);
    if (performance.now() - start > DECISION_MS) throw Error("Decision exceeded the one-second limit.");
    week.step(id);
    actions.push(id);
  }
  const ledger = fleetLedger(week.ledger);
  assert.deepEqual(replayFleetActions(config, actions), ledger);
  return {actions, ledger};
}

// Change only the current joint move. Both alternatives follow the same deployed gate thereafter.
export function forkFleetWeek(config, prefix, first, decide) {
  const week = createFleetWeek(config);
  for (const id of prefix) week.step(id);
  const suffix = [first];
  week.step(first);
  while (!week.done) {
    const action = decide(week.observe(), week.legalActions());
    week.step(action);
    suffix.push(action);
  }
  return [suffix, week.ledger.net, week.ledger.served];
}
