// Public agent interface for the Cutoff lab. Runs in Node.js and modern browsers.
import { availableCalls, CUTOFF_VERSION, createShift, observeShift, stepShift, verifyShift } from "./cutoff.js";

export { CUTOFF_VERSION, FAMILIES, noCheck, planner } from "./cutoff.js";
export const TRACE_FORMAT = "evalsim-cutoff-trace-v1";

export async function runCase(config, decide) {
  if (typeof decide !== "function") throw new TypeError("Pass a policy function.");
  const settings = { split: "train", family: "uncertain", variant: 0, ...config };
  const shift = createShift(settings);
  const actions = [];
  while (!shift.done) {
    const observation = observeShift(shift);
    const calls = availableCalls(observation);
    const id = await decide(observation, calls);
    if (!calls.some((action) => action.id === id)) throw new RangeError("Policy selected an unavailable call: " + id);
    stepShift(shift, id);
    actions.push(id);
  }
  return { format: TRACE_FORMAT, version: CUTOFF_VERSION, config: settings, actions, complete: true, score: verifyShift(shift) };
}

export function replayCase(record) {
  if (record?.format !== TRACE_FORMAT || !Array.isArray(record.actions)) throw new TypeError("Expected an EvalSim Cutoff trace.");
  if (record.version !== undefined && record.version !== CUTOFF_VERSION) throw new Error("Trace requires Cutoff " + record.version);
  const shift = createShift(record.config);
  for (const action of record.actions) stepShift(shift, action);
  if (shift.done !== record.complete) throw new Error("Trace completion differs from the simulator.");
  const score = verifyShift(shift);
  if (record.complete) {
    if (!record.score || Object.entries(score).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(record.score[key])))
      throw new Error("Trace score differs from the simulator.");
  }
  return { complete: shift.done, observation: observeShift(shift), score };
}
