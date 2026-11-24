import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { benchmarkReserve, verifyReserveReport } from "../docs/lib/reserve-benchmark.js";
import { chooseReserve, reserveCases, RESERVE_SUITE } from "../docs/lib/reserve-policy.js";
import { pointPlanner, stochasticPlanner } from "../docs/lib/reserve.js";

const usage = `Benchmark an agent on the fixed DISPATCH Reserve shifts (Node.js 22+).
  node tools/reserve.mjs --policy ./examples/reserve-agent.mjs --out my-result.json
  node tools/reserve.mjs --split validation --policy planner
  node tools/reserve.mjs --out python-result.json -- python3 examples/reserve_agent.py
  node tools/reserve.mjs --manifest
  node tools/reserve.mjs --verify my-result.json

--split test|validation    Use test for the released scorecard, validation for development.
--policy NAME|PATH        rl (default), planner, stochastic, or a local ES module.
--name LABEL              Set the display name stored in the report.
--out PATH                Save the full replayable JSON report.
-- PROGRAM [ARG ...]      Run a local agent using one JSON request and response per line.
--timeout-ms N            Maximum time per external-program decision (default 60000).
`;

async function programAgent(command, timeout) {
  const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const lines = output[Symbol.asyncIterator]();
  child.stdin.on("error", () => {}); // The write callback reports a closed input to the caller.
  const closed = new Promise(resolveClosed => child.once("close", resolveClosed));
  const close = async () => {
    output.close();
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
    try { await closed; } finally { clearTimeout(timer); }
  };
  try {
    await once(child, "spawn");
  } catch (error) {
    await close();
    throw error;
  }
  async function decide(observation, calls) {
    let timer;
    const reply = async () => {
      const request = JSON.stringify({ observation, calls }) + "\n";
      await new Promise((ok, fail) => child.stdin.write(request, error => error ? fail(error) : ok()));
      const line = await lines.next();
      if (line.done) throw new Error("Agent closed stdout before returning an action.");
      return JSON.parse(line.value).action;
    };
    try {
      return await Promise.race([reply(), new Promise((_, fail) => {
        timer = setTimeout(() => fail(new Error("Agent decision timed out.")), timeout);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  return { createPolicy: () => decide, close };
}

async function moduleAgent(policy, weights) {
  const builtins = { rl: obs => chooseReserve(obs, weights), planner: pointPlanner, stochastic: stochasticPlanner };
  if (Object.hasOwn(builtins, policy)) return { createPolicy: () => builtins[policy] };
  const module = await import(pathToFileURL(resolve(policy)).href);
  if (typeof module.createPolicy === "function") return { createPolicy: module.createPolicy };
  if (typeof module.default === "function") return { createPolicy: () => module.default };
  throw new TypeError("Export a decision function as default, or export a createPolicy factory.");
}

async function saveReport(path, report) {
  const tmp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, JSON.stringify(report) + "\n", { flag: "wx" });
    await rename(tmp, path);
  } finally {
    await unlink(tmp).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

function display(report) {
  const number = n => n.toFixed(2);
  console.log(report.suite + " / " + report.split + " / " + report.policy);
  console.log("Mean net credits per shift");
  console.table(Object.entries({ all: report.summary.all, ...report.summary.byFamily }).map(([family, group]) => ({
    family, shifts: group.shifts, agent: number(group.mean), RL: number(group.references.rl.mean),
    "point planner": number(group.references.planner.mean), "stochastic planner": number(group.references.stochastic.mean),
  })));
  console.log("Paired differences for your agent across all shifts");
  for (const [reference, result] of Object.entries(report.summary.all.references)) {
    console.log(reference + ": " + number(result.delta) + " credits (95% interval " +
      result.interval95.map(number).join(" to ") + "); " + result.wins + " wins / " +
      result.ties + " ties / " + result.losses + " losses");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const command = separator < 0 ? [] : args.slice(separator + 1);
  const { values } = parseArgs({ args: separator < 0 ? args : args.slice(0, separator), options: {
    policy: { type: "string" }, split: { type: "string" }, out: { type: "string" }, name: { type: "string" },
    "timeout-ms": { type: "string" }, manifest: { type: "boolean" }, verify: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) return console.log(usage);
  if (separator >= 0 && !command.length) throw new Error("Provide a program after --.");
  if (values.verify !== undefined && (separator >= 0 || Object.keys(values).length !== 1)) throw new Error("Use --verify on its own.");
  const split = values.split ?? "test";
  if (!["test", "validation"].includes(split)) throw new Error("Choose --split test or validation.");
  if (values.manifest) {
    if (command.length || Object.keys(values).some(k => !["manifest", "split"].includes(k))) throw new Error("Use --manifest with only an optional --split.");
    return console.log(JSON.stringify({ suite: RESERVE_SUITE.id, split, cases: reserveCases(split) }, null, 2));
  }
  if (command.length && values.policy !== undefined) throw new Error("Choose --policy or a program after --.");
  const timeout = Number(values["timeout-ms"] ?? 60000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647 ||
      (values["timeout-ms"] !== undefined && !command.length)) throw new Error("Use a positive --timeout-ms with an external program.");
  const release = JSON.parse(await readFile(new URL("../docs/data/reserve/results.json", import.meta.url), "utf8"));
  const weights = release.checkpoint.weights;
  if (values.verify !== undefined) {
    const report = await verifyReserveReport(JSON.parse(await readFile(values.verify, "utf8")), weights);
    display(report);
    return console.log("Verified every action, ledger and comparison against the fixed manifest.");
  }
  const policy = values.policy ?? "rl";
  const agent = command.length ? await programAgent(command, timeout) : await moduleAgent(policy, weights);
  try {
    const report = await benchmarkReserve({ split, weights, policy: values.name ?? basename(command[0] ?? policy), createPolicy: agent.createPolicy });
    if (values.out !== undefined) await saveReport(values.out, report);
    display(report);
    if (values.out !== undefined) console.log("Saved " + values.out);
  } finally {
    await agent.close?.();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
