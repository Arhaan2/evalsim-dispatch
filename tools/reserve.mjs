import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { benchmarkReserve, reserveReferences, verifyReserveReport } from "../docs/lib/reserve-benchmark.js";
import { reserveCases, RESERVE_SUITE } from "../docs/lib/reserve-policy.js";
import { benchmarkDrift, driftReferences, verifyDriftReport } from "../docs/lib/drift-benchmark.js";
import { DRIFT_SUITE, driftCases } from "../docs/lib/drift.js";
import { benchmarkTurns, turnsReferences, verifyTurnsReport, TURNS_EVALUATION_SPLITS } from "../docs/lib/turns-benchmark.js";
import { TURNS_SUITE, turnsCases } from "../docs/lib/turns.js";
import { chooseTurns } from "../docs/lib/turns-policy.js";
import { benchmarkCloses, closesReferences, verifyClosesReport, CLOSES_EVALUATION_SPLITS } from "../docs/lib/closes-benchmark.js";
import { CLOSES_SUITE, closesCases } from "../docs/lib/closes.js";
import { benchmarkTrust, trustReferences, trustWeights, verifyTrustReport, TRUST_EVALUATION_SPLITS } from "../docs/lib/trust-benchmark.js";
import { TRUST_SUITE, trustCases } from "../docs/lib/trust.js";

const labs = {
  reserve: { id: RESERVE_SUITE.id, cases: reserveCases, references: reserveReferences, benchmark: benchmarkReserve, verify: verifyReserveReport },
  drift: { id: DRIFT_SUITE.id, cases: driftCases, references: driftReferences, benchmark: benchmarkDrift, verify: verifyDriftReport },
  turns: { id: TURNS_SUITE.id, cases: turnsCases, references: turnsReferences, benchmark: benchmarkTurns,
    verify: verifyTurnsReport, splits: TURNS_EVALUATION_SPLITS },
  closes: { id: CLOSES_SUITE.id, cases: closesCases, references: closesReferences, benchmark: benchmarkCloses,
    verify: verifyClosesReport, splits: CLOSES_EVALUATION_SPLITS },
  trust: { id: TRUST_SUITE.id, cases: trustCases, references: trustReferences, benchmark: benchmarkTrust,
    verify: verifyTrustReport, splits: TRUST_EVALUATION_SPLITS },
};

async function loadRelease(name) {
  const url = new URL("../docs/data/" + name + "/results.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

async function loadCheckpoint(name) {
  return (await loadRelease(name)).checkpoint;
}

async function loadWeights(lab) {
  if (lab === labs.trust) {
    const releases = await Promise.all(["trust", "closes", "drift", "turns"].map(loadRelease));
    return trustWeights(...releases);
  }
  if (lab === labs.reserve) return (await loadCheckpoint("reserve")).weights;
  if (lab === labs.closes) {
    const [closes, turns, drift] = await Promise.all(["closes", "turns", "drift"].map(loadCheckpoint));
    return { closes: closes.weights, ablated: closes.ablatedWeights, turns: turns.weights, drift: drift.weights };
  }
  if (lab === labs.turns) {
    const [turns, drift] = await Promise.all([loadCheckpoint("turns"), loadCheckpoint("drift")]);
    return { turns: turns.weights, drift: drift.weights };
  }
  const [drift, legacy] = await Promise.all([loadCheckpoint("drift"), loadCheckpoint("reserve")]);
  return { drift: drift.weights, legacy: legacy.weights };
}

const usage = `Benchmark an agent on fixed DISPATCH freight shifts (Node.js 22+).
  node tools/reserve.mjs --policy ./examples/reserve-agent.mjs --out my-result.json
  node tools/reserve.mjs --split validation --policy planner
  node tools/reserve.mjs --suite drift --policy ./examples/reserve-agent.mjs --out drift.json
  node tools/reserve.mjs --suite drift --policy adaptive
  node tools/reserve.mjs --suite turns --policy ./examples/reserve-agent.mjs --out turns.json
  node tools/reserve.mjs --suite turns --split retention --policy rl
  node tools/reserve.mjs --suite drift --policy turns --out turns-on-drift.json
  node tools/reserve.mjs --suite closes --policy ./examples/reserve-agent.mjs --out closes.json
  node tools/reserve.mjs --suite closes --split retention --policy rl
  node tools/reserve.mjs --suite trust --policy ./examples/reserve-agent.mjs --out trust.json
  node tools/reserve.mjs --suite trust --split retention --policy rl
  node tools/reserve.mjs --suite trust --split archive --policy binary
  node tools/reserve.mjs --out python-result.json -- python3 examples/reserve_agent.py
  node tools/reserve.mjs --manifest
  node tools/reserve.mjs --verify my-result.json

--suite NAME              reserve (default), drift, turns, closes or trust.
--split NAME              test or validation. Turns, Closes and Trust offer retention on earlier drops.
                          The Trust archive replays all eight previous Closes patterns on new seeds.
--policy NAME|PATH        Local ES module, or a reference. Every suite offers rl and stochastic.
                          Reserve adds planner. Drift adds adaptive, legacy and the new turns policy.
                          Turns adds adaptive and the previous drift policy. rl selects the new agent.
                          Closes adds ablated (same training without history), turns, drift and adaptive.
                          Trust adds binary (two-expert router), votes (reduced gate inputs), closes, drift, turns and adaptive.
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

async function moduleAgent(policy, builtins) {
  if (Object.hasOwn(builtins, policy)) return { createPolicy: () => builtins[policy] };
  if (["planner", "adaptive", "legacy", "turns", "drift", "ablated", "binary", "votes", "closes"].includes(policy)) throw new Error("Policies in this suite: " + Object.keys(builtins).join(", "));
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
  const labels = { rl: "RL", planner: "point planner", stochastic: "stochastic planner", adaptive: "adaptive planner",
    legacy: "original RL", drift: "previous Drift RL", turns: "previous Turns RL", ablated: "RL without history",
    binary: "two-expert router", votes: "reduced-input router", closes: "Closes history RL" };
  console.log(report.suite + " / " + report.split + " / " + report.policy);
  console.log("Mean net credits per shift");
  console.table(Object.entries({ all: report.summary.all, ...report.summary.byFamily }).map(([family, group]) => ({
    family, shifts: group.shifts, agent: number(group.mean),
    ...Object.fromEntries(Object.entries(group.references).map(([key, ref]) => [labels[key], number(ref.mean)])),
  })));
  console.log("Paired differences for your agent across all shifts");
  for (const [reference, result] of Object.entries(report.summary.all.references)) {
    console.log(reference + ": " + number(result.delta) + " credits (95% interval " +
      result.interval95.map(number).join(" to ") + "); " + result.wins + " wins / " +
      result.ties + " ties / " + result.losses + " losses");
  }
  if (report.summary.byStratum) {
    console.log("Mean paired differences by demand pattern type");
    console.table(Object.entries(report.summary.byStratum).map(([stratum, group]) => ({
      stratum, shifts: group.shifts, "agent minus stochastic": number(group.references.stochastic.delta),
      "95% interval": group.references.stochastic.interval95.map(number).join(" to "),
      "agent minus Drift RL": number(group.references.drift.delta),
      "95% interval vs Drift": group.references.drift.interval95.map(number).join(" to "),
    })));
  }
  if (report.summary.byStratumEnding) {
    console.log("Paired differences across hot and cold endings");
    const comparisons = [];
    const other = report.summary.all.references.closes ? "closes" : "ablated";
    const intervalHeading = other === "closes" ? "95% vs Closes" : "95% vs no history";
    for (const [pattern, endings] of Object.entries(report.summary.byStratumEnding)) {
      for (const [ending, group] of Object.entries(endings)) {
        const planner = group.references.stochastic;
        const paired = group.references[other];
        comparisons.push({ pattern, ending, shifts: group.shifts, agent: number(group.mean),
          "agent minus planner": number(planner.delta), "95% vs planner": planner.interval95.map(number).join(" to "),
          ["agent minus " + labels[other]]: number(paired.delta), [intervalHeading]: paired.interval95.map(number).join(" to ") });
      }
    }
    console.table(comparisons);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const command = separator < 0 ? [] : args.slice(separator + 1);
  const { values } = parseArgs({ args: separator < 0 ? args : args.slice(0, separator), options: {
    suite: { type: "string" }, policy: { type: "string" }, split: { type: "string" }, out: { type: "string" }, name: { type: "string" },
    "timeout-ms": { type: "string" }, manifest: { type: "boolean" }, verify: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) return console.log(usage);
  if (separator >= 0 && !command.length) throw new Error("Provide a program after --.");
  const suite = values.suite ?? "reserve";
  if (!Object.hasOwn(labs, suite)) throw new Error("Choose --suite " + Object.keys(labs).join(", ") + ".");
  const lab = labs[suite];
  if (values.verify !== undefined) {
    if (separator >= 0 || Object.keys(values).some(k => !["verify", "suite"].includes(k))) throw new Error("Use --verify with only an optional --suite.");
    const saved = JSON.parse(await readFile(values.verify, "utf8"));
    const target = values.suite ? lab : Object.values(labs).find(item => item.id === saved?.suite);
    if (!target) throw new Error("Unrecognized benchmark suite.");
    const report = await target.verify(saved, await loadWeights(target));
    display(report);
    return console.log("Verified every action, ledger and comparison against the fixed manifest.");
  }
  const split = values.split ?? "test";
  const splits = lab.splits ?? ["test", "validation"];
  if (!splits.includes(split)) throw new Error("Unknown --split. Choose " + splits.join(", ") + ".");
  if (values.manifest) {
    if (command.length || Object.keys(values).some(k => !["manifest", "split", "suite"].includes(k))) throw new Error("Use --manifest with only --suite and --split.");
    return console.log(JSON.stringify({ suite: lab.id, split, cases: lab.cases(split) }, null, 2));
  }
  if (command.length && values.policy !== undefined) throw new Error("Choose --policy or a program after --.");
  const timeout = Number(values["timeout-ms"] ?? 60000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647 ||
      (values["timeout-ms"] !== undefined && !command.length)) throw new Error("Use a positive --timeout-ms with an external program.");
  const weights = await loadWeights(lab);
  const policy = values.policy ?? "rl";
  const available = lab.references(weights);
  if (lab === labs.turns) available.turns = available.rl;
  if (lab === labs.drift && policy === "turns" && !command.length) {
    const { weights: turnsWeights } = await loadCheckpoint("turns");
    available.turns = observation => chooseTurns(observation, turnsWeights);
  }
  const agent = command.length ? await programAgent(command, timeout) : await moduleAgent(policy, available);
  try {
    const report = await lab.benchmark({ split, weights, policy: values.name ?? basename(command[0] ?? policy), createPolicy: agent.createPolicy });
    if (values.out !== undefined) await saveReport(values.out, report);
    display(report);
    if (values.out !== undefined) console.log("Saved " + values.out);
  } finally {
    await agent.close?.();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
