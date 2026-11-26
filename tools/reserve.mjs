import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import { benchmarkRally, rallyReferences, rallyWeights, verifyRallyReport, RALLY_EVALUATION_SPLITS } from "../docs/lib/rally-benchmark.js";
import { RALLY_SUITE, rallyCases } from "../docs/lib/rally.js";
import { benchmarkSurvey, surveyReferences, surveyWeights, verifySurveyReport, SURVEY_EVALUATION_SPLITS } from "../docs/lib/survey-benchmark.js";
import { SURVEY_SUITE, surveyCases } from "../docs/lib/survey.js";
import { benchmarkBooking, bookingReferences, bookingWeights, verifyBookingReport, BOOKING_EVALUATION_SPLITS } from "../docs/lib/booking-benchmark.js";
import { BOOKING_SUITE, bookingCases } from "../docs/lib/booking.js";

import { benchmarkPaid, paidReferences, paidWeights, verifyPaidReport, PAID_EVALUATION_SPLITS } from "../docs/lib/paid-benchmark.js";
import { PAID_SUITE, paidCases } from "../docs/lib/paid.js";

import { benchmarkTariff, tariffReferences, tariffWeights, verifyTariffReport, TARIFF_EVALUATION_SPLITS } from "../docs/lib/tariff-benchmark.js";
import { TARIFF_SUITE, tariffCases } from "../docs/lib/tariff.js";

import { benchmarkLastslot,lastslotReferences,verifyLastslotReport,LASTSLOT_EVALUATION_SPLITS } from "../docs/lib/lastslot-benchmark.js";
import { LASTSLOT_SUITE,lastslotCases } from "../docs/lib/lastslot.js";

import { benchmarkLoadchoice, loadchoiceReferences, verifyLoadchoiceReport, LOADCHOICE_EVALUATION_SPLITS } from "../docs/lib/loadchoice-benchmark.js";
import { LOADCHOICE_SUITE, loadchoiceCases } from "../docs/lib/loadchoice.js";

import { benchmarkWaitcost, waitcostReferences, verifyWaitcostReport, WAITCOST_EVALUATION_SPLITS } from "../docs/lib/waitcost-benchmark.js";
import { WAITCOST_SUITE, waitcostCases } from "../docs/lib/waitcost.js";

import { benchmarkFleetWeek, fleetReferences, verifyFleetReport } from "../docs/lib/fleetweek-benchmark.js";
import { DECISION_MS, FLEET_SUITE, FLEET_SPLITS, fleetCases } from "../docs/lib/fleetweek-study.js";

import {benchmarkOvernight,overnightReferences,verifyOvernightReport} from "../docs/lib/overnight-benchmark.js";
import {OVERNIGHT_SUITE,OVERNIGHT_SPLITS,overnightCases} from "../docs/lib/overnight-study.js";

import {benchmarkOverride, overrideReferences, verifyOverrideReport} from "../docs/lib/override-benchmark.js";
import {OVERRIDE_SUITE, OVERRIDE_SPLITS, overrideCases} from "../docs/lib/override-study.js";

import {benchmarkUncertainty, uncertaintyReferences, verifyUncertaintyReport} from "../docs/lib/uncertainty-benchmark.js";
import {UNCERTAINTY_SUITE, UNCERTAINTY_SPLITS, uncertaintyCases} from "../docs/lib/uncertainty-study.js";

import {benchmarkLoss, lossReferences, verifyLossReport} from "../docs/lib/loss-benchmark.js";
import {LOSS_SUITE, LOSS_SPLITS, lossCases} from "../docs/lib/loss-study.js";

import {benchmarkClosure, closureReferences, verifyClosureReport, CLOSURE_SUITE, CLOSURE_SPLITS, closureCases} from "../docs/lib/closure-benchmark.js";

const labs = {
  closure:{id:CLOSURE_SUITE, cases:closureCases, references:closureReferences, benchmark:benchmarkClosure, verify:verifyClosureReport, splits:CLOSURE_SPLITS},
  loss: {id: LOSS_SUITE, cases: lossCases, references: lossReferences, benchmark: benchmarkLoss,
    verify: verifyLossReport, splits: LOSS_SPLITS},
  uncertainty: {id: UNCERTAINTY_SUITE, cases: uncertaintyCases, references: uncertaintyReferences, benchmark: benchmarkUncertainty,
    verify: verifyUncertaintyReport, splits: UNCERTAINTY_SPLITS},
  override: {id: OVERRIDE_SUITE, cases: overrideCases, references: overrideReferences, benchmark: benchmarkOverride,
    verify: verifyOverrideReport, splits: OVERRIDE_SPLITS},
  overnight:{id:OVERNIGHT_SUITE,cases:overnightCases,references:overnightReferences,benchmark:benchmarkOvernight,verify:verifyOvernightReport,splits:OVERNIGHT_SPLITS},
  fleetweek: {id: FLEET_SUITE, cases: fleetCases, references: fleetReferences, benchmark: benchmarkFleetWeek, verify: verifyFleetReport, splits: FLEET_SPLITS},
  waitcost: { id: WAITCOST_SUITE.id, cases: waitcostCases, references: waitcostReferences, benchmark: benchmarkWaitcost, verify: verifyWaitcostReport, splits: WAITCOST_EVALUATION_SPLITS },
  loadchoice: { id: LOADCHOICE_SUITE.id, cases: loadchoiceCases, references: loadchoiceReferences, benchmark: benchmarkLoadchoice, verify: verifyLoadchoiceReport, splits: LOADCHOICE_EVALUATION_SPLITS },
  lastslot: {id:LASTSLOT_SUITE.id,cases:lastslotCases,references:lastslotReferences,benchmark:benchmarkLastslot,verify:verifyLastslotReport,splits:LASTSLOT_EVALUATION_SPLITS},
  tariff: { id:TARIFF_SUITE.id, cases:tariffCases, references:tariffReferences, benchmark:benchmarkTariff, verify:verifyTariffReport, splits:TARIFF_EVALUATION_SPLITS },
  paid: { id: PAID_SUITE.id, cases: paidCases, references: paidReferences, benchmark: benchmarkPaid,
    verify: verifyPaidReport, splits: PAID_EVALUATION_SPLITS },
  reserve: { id: RESERVE_SUITE.id, cases: reserveCases, references: reserveReferences, benchmark: benchmarkReserve, verify: verifyReserveReport },
  drift: { id: DRIFT_SUITE.id, cases: driftCases, references: driftReferences, benchmark: benchmarkDrift, verify: verifyDriftReport },
  turns: { id: TURNS_SUITE.id, cases: turnsCases, references: turnsReferences, benchmark: benchmarkTurns,
    verify: verifyTurnsReport, splits: TURNS_EVALUATION_SPLITS },
  closes: { id: CLOSES_SUITE.id, cases: closesCases, references: closesReferences, benchmark: benchmarkCloses,
    verify: verifyClosesReport, splits: CLOSES_EVALUATION_SPLITS },
  trust: { id: TRUST_SUITE.id, cases: trustCases, references: trustReferences, benchmark: benchmarkTrust,
    verify: verifyTrustReport, splits: TRUST_EVALUATION_SPLITS },
  rally: { id: RALLY_SUITE.id, cases: rallyCases, references: rallyReferences, benchmark: benchmarkRally,
    verify: verifyRallyReport, splits: RALLY_EVALUATION_SPLITS },
  survey: { id: SURVEY_SUITE.id, cases: surveyCases, references: surveyReferences, benchmark: benchmarkSurvey,
    verify: verifySurveyReport, splits: SURVEY_EVALUATION_SPLITS },
  booking: { id: BOOKING_SUITE.id, cases: bookingCases, references: bookingReferences, benchmark: benchmarkBooking,
    verify: verifyBookingReport, splits: BOOKING_EVALUATION_SPLITS },
};

async function loadRelease(name) {
  const url = new URL("../docs/data/" + name + "/results.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

async function loadCheckpoint(name) {
  return (await loadRelease(name)).checkpoint;
}

function pricedStudy(lab) {
  if (lab === labs.waitcost) return "waitcost";
  return lab === labs.loadchoice ? "loadchoice" : lab === labs.lastslot ? "lastslot" : null;
}

function fleetStudy(lab) {
  if (lab === labs.closure) return "closure";
  if (lab === labs.loss) return "loss";
  if (lab === labs.uncertainty) return "uncertainty";
  if (lab === labs.override) return "override";
  if (lab === labs.overnight) return "overnight";
  if (lab === labs.fleetweek) return "fleetweek";
  return null;
}

async function loadPricedBank(lab,split) {
  const name = fleetStudy(lab) ?? pricedStudy(lab);
  if (!name) return undefined;
  if (!lab.splits.includes(split)) throw new Error("Unknown priced evaluation split.");
  const metadata=await loadRelease(name);
  const raw=await readFile(new URL("../docs/data/"+name+"/"+split+".json",import.meta.url));
  if(createHash("sha256").update(raw).digest("hex")!==metadata.banks[split]) throw new Error("The packaged reference bank differs from the release.");
  return JSON.parse(raw);
}

async function releaseFleetModel(name, seed, digest) {
  const raw = await readFile(new URL("../docs/data/" + name + "/model-" + seed + ".json", import.meta.url));
  if (createHash("sha256").update(raw).digest("hex") !== digest) throw Error("Fleet checkpoint digest mismatch.");
  return JSON.parse(raw);
}
async function loadWeights(lab) {
  const fleetName = fleetStudy(lab);
  if (fleetName) {
    const name = fleetName;
    const metadata = await loadRelease(name);
    const current = await releaseFleetModel(name,metadata.primarySeed,metadata.weightHashes[metadata.primarySeed]);
    if (lab === labs.fleetweek) return current;
    if (lab === labs.closure) {
      const override=await releaseFleetModel("override",13,metadata.overrideHash);
      const uncertainty=await releaseFleetModel("uncertainty",13,metadata.uncertaintyHash);
      return {current,override,uncertainty};
    }
    const previous = await releaseFleetModel("fleetweek",13,metadata.previousHash);
    if (lab === labs.overnight) return {current, previous};
    if (lab === labs.loss) {
      const [override, uncertainty] = await Promise.all([
        releaseFleetModel("override", 13, metadata.overrideHash), releaseFleetModel("uncertainty", 13, metadata.uncertaintyHash),
      ]);
      return {current, previous, override, uncertainty};
    }
    const overnight = await releaseFleetModel("overnight",13,metadata.overnightHash);
    if (lab === labs.override) return {current, previous, overnight};
    const override = await releaseFleetModel("override",13,metadata.overrideHash);
    return {current, previous, overnight, override};
  }
  const name=pricedStudy(lab);
  if (name) return JSON.parse(await readFile(new URL("../docs/data/"+name+"/desk.json",import.meta.url))).weights;
  if (lab === labs.tariff) {
    const names = ["tariff","paid","booking","survey","rally","trust","closes","drift","turns"];
    return tariffWeights(...await Promise.all(names.map(loadRelease)));
  }
  if (lab === labs.paid) {
    const releases = await Promise.all(["paid", "booking", "survey", "rally", "trust", "closes", "drift", "turns"].map(loadRelease));
    return paidWeights(...releases);
  }
  if (lab === labs.booking) {
    const releases = await Promise.all(["booking", "survey", "rally", "trust", "closes", "drift", "turns"].map(loadRelease));
    return bookingWeights(...releases);
  }
  if (lab === labs.survey) {
    const releases = await Promise.all(["survey", "rally", "trust", "closes", "drift", "turns"].map(loadRelease));
    return surveyWeights(...releases);
  }
  if (lab === labs.rally) {
    const releases = await Promise.all(["rally", "trust", "closes", "drift", "turns"].map(loadRelease));
    return rallyWeights(...releases);
  }
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
  node tools/reserve.mjs --suite closure --split test --policy ./examples/fleetweek-agent.mjs --out closure.json
  node tools/reserve.mjs --suite loss --split test --policy ./examples/fleetweek-agent.mjs --out loss.json
  node tools/reserve.mjs --suite loss --split archive --out loss-python.json -- python3 examples/fleetweek_agent.py
  node tools/reserve.mjs --suite uncertainty --split test --policy ./examples/fleetweek-agent.mjs --out uncertainty.json
  node tools/reserve.mjs --suite override --split test --policy ./examples/fleetweek-agent.mjs --out overrides.json
  node tools/reserve.mjs --suite overnight --split validation --policy ./examples/fleetweek-agent.mjs --out nights.json
  node tools/reserve.mjs --suite overnight --split archive --out double-return.json -- python3 examples/fleetweek_agent.py
  node tools/reserve.mjs --suite fleetweek --split validation --policy ./examples/fleetweek-agent.mjs --out week.json
  node tools/reserve.mjs --suite fleetweek --split test --out week.json -- python3 examples/fleetweek_agent.py
  node tools/reserve.mjs --suite drift --policy adaptive
  node tools/reserve.mjs --suite turns --policy ./examples/reserve-agent.mjs --out turns.json
  node tools/reserve.mjs --suite turns --split retention --policy rl
  node tools/reserve.mjs --suite drift --policy turns --out turns-on-drift.json
  node tools/reserve.mjs --suite closes --policy ./examples/reserve-agent.mjs --out closes.json
  node tools/reserve.mjs --suite closes --split retention --policy rl
  node tools/reserve.mjs --suite trust --policy ./examples/reserve-agent.mjs --out trust.json
  node tools/reserve.mjs --suite trust --split retention --policy rl
  node tools/reserve.mjs --suite trust --split archive --policy binary
  node tools/reserve.mjs --suite rally --policy ./examples/reserve-agent.mjs --out rally.json
  node tools/reserve.mjs --suite rally --split retention --policy rl
  node tools/reserve.mjs --suite rally --split archive --policy trust
  node tools/reserve.mjs --suite survey --policy ./examples/reserve-agent.mjs --out survey.json
  node tools/reserve.mjs --suite survey --split retention --policy rl
  node tools/reserve.mjs --suite survey --split archive --policy rally
  node tools/reserve.mjs --suite booking --policy ./examples/reserve-agent.mjs --out booking.json
  node tools/reserve.mjs --suite booking --split retention --policy rl
  node tools/reserve.mjs --suite booking --split archive --policy survey
  node tools/reserve.mjs --suite paid --policy ./examples/paid-agent.mjs --out paid.json
  node tools/reserve.mjs --suite paid --split retention --policy planner
  node tools/reserve.mjs --suite paid --split archive -- python3 examples/paid_agent.py
  node tools/reserve.mjs --suite tariff --policy ./examples/tariff-agent.mjs --out tariff.json
  node tools/reserve.mjs --suite tariff --split retention --policy planner
  node tools/reserve.mjs --suite tariff --out python-tariff.json -- python3 examples/tariff_agent.py
  node tools/reserve.mjs --suite waitcost --policy ./examples/lastslot-agent.mjs --out waitcost.json
  node tools/reserve.mjs --suite waitcost --split validation -- python3 examples/lastslot_agent.py
  node tools/reserve.mjs --suite loadchoice --policy ./examples/lastslot-agent.mjs --out choice.json
  node tools/reserve.mjs --suite loadchoice --split validation -- python3 examples/lastslot_agent.py
  node tools/reserve.mjs --suite lastslot --policy ./examples/lastslot-agent.mjs --out lastslot.json
  node tools/reserve.mjs --suite lastslot --split validation -- python3 examples/lastslot_agent.py
  node tools/reserve.mjs --out python-result.json -- python3 examples/reserve_agent.py
  node tools/reserve.mjs --manifest
  node tools/reserve.mjs --verify my-result.json

--suite NAME              reserve (default), drift, turns, closes, trust, rally, survey, booking, paid, tariff, lastslot, loadchoice, waitcost, fleetweek, overnight, override, uncertainty, loss or closure.
                          Overnight adds fresh weeks and a double-return archive. Policies: rl, planner, previous, greedy, noEmpty.
                          Fleetweek compares two trucks across five days; policies are rl, planner and greedy.
--split NAME              test or validation. Turns, Closes, Trust, Rally, Survey and Booking also offer retention.
                          Closure offers validation, test, clean and archive. Policies: rl, planner and flatRisk.
                          Loss offers validation, test and the original double-return archive.
                          The Trust archive replays all eight previous Closes patterns on new seeds.
                          The Rally archive replays the eight previous Trust test patterns on new seeds.
                          The Survey archive replays the eight previous Rally test patterns on new seeds.
                          The Booking archive replays the eight previous Survey test patterns on new seeds.
                          Paid offers test, validation, retention, archive (Booking) and surveyArchive (Survey).
                          Waitcost compares survey-induced deferrals with skipping, unguarded bookings and the planner.
                          Loadchoice evaluates post-survey bookings on fresh, original and archived Last Slot markets.
                          Lastslot offers validation, test, retention and archive, including an always-skip specialist (rlNever).
                          Tariff crosses seven prices with each validation, test, retention or archived Paid tape.
--policy NAME|PATH        Loss offers rl, planner, flatRisk (published constant penalty), constantLoss (fixed probability),
                          uncertainty, override and previous.
                          Uncertainty offers rl, planner, override, meanOnly, flatRisk, overnight and previous.
                          Override offers rl, planner (never override), always (force every proposal), overnight, previous and greedy.
                          Local ES module or reference. Freight Reserve and its survey-series successors offer rl and stochastic.
                          Tariff adds paid (previous Paid learner at the current tariff) and reports purchases by price.
                          Paid uses planner for the optional survey planner. Its rlNever, rlAlways,
                          plannerNever and plannerAlways force the purchase decision at the one-credit fee.
                          Free controls are shown alongside every report at a separate zero fee.
                          Reserve adds planner. Drift adds adaptive, legacy and the new turns policy.
                          Turns adds adaptive and the previous drift policy. rl selects the new agent.
                          Closes adds ablated (same training without history), turns, drift and adaptive.
                          Trust adds binary (two-expert router), votes (reduced gate inputs), closes, drift, turns and adaptive.
                          Rally adds ablated (current-only control), trust, closes, drift, turns and adaptive.
                          Survey adds always/never (survey-use controls), rally, ablated (Rally current-only),
                          trust, closes, drift, turns and adaptive.
                          Booking adds equal (equal-weight learner), earlyPlanner and earlyRally
                          (each hands the last two decisions to Survey), and survey.
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
  if (["planner", "adaptive", "legacy", "turns", "drift", "ablated", "binary", "votes", "closes", "trust", "rally", "always", "never", "survey", "equal", "earlyPlanner", "earlyRally"].includes(policy)) throw new Error("Policies in this suite: " + Object.keys(builtins).join(", "));
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
  if ([FLEET_SUITE, OVERNIGHT_SUITE, OVERRIDE_SUITE, UNCERTAINTY_SUITE, LOSS_SUITE, CLOSURE_SUITE].includes(report.suite)) {
    console.log(report.suite + " / " + report.split + " / " + report.policy + " / " + report.cases.length + " weeks");
    const all = report.summary.all;
    console.table(Object.entries(all.policies).map(([name,p]) => ({policy: name, netCredits: p.net.toFixed(2),
      onTimePct: p.onTime.toFixed(2), emptyMiles: p.emptyMiles.toFixed(2), weeksMeetingTarget: p.targetWeeks})));
    for (const [name, c] of Object.entries(all.comparisons)) {
      console.log("Agent minus " + name + " in weekly credits: " + c.net.toFixed(2) + " [" + c.net95.map(n => n.toFixed(2)).join(", ") + "]; on-time difference " + c.servicePP.toFixed(3) + " pp [" + c.service95.map(n => n.toFixed(3)).join(", ") + "].");
    }
    return;
  }
  const number = n => n.toFixed(2);
  const labels = { rl: "RL", planner: "point planner", stochastic: "stochastic planner", adaptive: "adaptive planner",
    legacy: "original RL", drift: "previous Drift RL", turns: "previous Turns RL", ablated: "RL without history",
    binary: "two-expert router", votes: "reduced-input router", closes: "Closes history RL", trust: "Trust router",
    rally: "Rally agent", always: "always use survey", never: "never use survey", survey: "Survey agent",
    equal: "equal-weight learner", earlyPlanner: "planner then Survey", earlyRally: "Rally then Survey" };
  const isPaid = report.suite === PAID_SUITE.id;
  const isWaitcost = report.suite === WAITCOST_SUITE.id;
  const isLoadchoice = isWaitcost || report.suite === LOADCHOICE_SUITE.id;
  const isLastslot = isLoadchoice || report.suite === LASTSLOT_SUITE.id;
  const isTariff = report.suite === TARIFF_SUITE.id || isLastslot;
  if (isPaid || isTariff) Object.assign(labels, { planner: "paid survey planner", booking: "Booking agent", rlNever: "RL skip", rlAlways: "RL buy",
    rlFree: "RL free survey", plannerNever: "planner skip", plannerAlways: "planner buy", plannerFree: "planner free survey", paid: "previous Paid agent" });
  if(isLastslot) Object.assign(labels,{rl:"one-slot specialist",rlAlways:"buy with one slot",tariff:"previous Tariff agent"});
  if (isLoadchoice) Object.assign(labels,{rl:"load-choice learner",lastslot:"previous Last Slot specialist"});
  if (isWaitcost) Object.assign(labels,{rl:"learned wait policy",loadchoice:"previous Load Choice agent",unguarded:"same gate without the stopping rule",unguardedAlways:"forced buy without the stopping rule",alwaysStop:"stop at all eligible disagreements",alwaysStopForced:"forced buy and stop at all disagreements"});
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
  if (isPaid) {
    const fees = report.cases.reduce((total,row) => total + row.feePaid,0);
    console.log("Survey purchases: " + fees + " / " + report.cases.length + " shifts. Total survey fees: " + fees + " credits.");
  }
  if (isTariff) {
    console.log("Survey purchases and fee-adjusted earnings by posted price");
    console.table(Object.entries(report.summary.byPrice).map(([cents,{all}]) => ({ cents, tapes:all.tapes, buys:all.bought, fees:all.fees, net:number(all.mean),
      "planner buys":all.references.planner.bought, "agent minus planner":number(all.references.planner.delta),
      "95% interval":all.references.planner.interval95.map(number).join(" to ") })));
  }
  if(isLastslot) {
    const precision = value => value.toFixed(value !== 0 && Math.abs(value) < 0.001 ? 6 : 3);
    const p=report.summary.positiveByStratumEnding;
    console.log("Positive-price target comparisons, net credits per offered shift");
    const rows=Object.entries(p).flatMap(([pattern,ends])=>Object.entries(ends).map(([ending,g])=>({pattern,ending,shifts:g.shifts,
      "vs specialist skip":precision(g.references.rlNever.delta),"skip 95%":g.references.rlNever.interval95.map(precision).join(" to "),
      "vs planner":precision(g.references.planner.delta),"planner 95%":g.references.planner.interval95.map(precision).join(" to ")})));
    console.table(rows);
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
    const refs = report.summary.all.references;
    const other = ["survey","rally","trust","closes","ablated"].find(key => refs[key]);
    const intervalHeading = { survey: "95% vs Survey", rally: "95% vs Rally", trust: "95% vs Trust", closes: "95% vs Closes", ablated: "95% vs no history" }[other];
    for (const [pattern, endings] of Object.entries(report.summary.byStratumEnding)) {
      for (const [ending, group] of Object.entries(endings)) {
        const planner = group.references[isPaid || isTariff ? "planner" : "stochastic"];
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
    const report = await target.verify(saved, await loadWeights(target),await loadPricedBank(target,saved.split));
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
  const fleet = Boolean(fleetStudy(lab));
  const timeout = Number(values["timeout-ms"] ?? (fleet ? DECISION_MS : 60000));
  if (fleet && timeout > DECISION_MS) throw Error("Fleet benchmarks allow at most 1000 ms per decision.");
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
  if (lab === labs.paid && !command.length && ["rlFree","plannerFree"].includes(policy)) {
    throw new Error("The official tariff is one credit. Both zero-fee controls appear in every paid benchmark report.");
  }
  const agent = command.length ? await programAgent(command, timeout) : await moduleAgent(policy, available);
  try {
    const report = await lab.benchmark({ split, weights, bank:await loadPricedBank(lab,split), policy: values.name ?? basename(command[0] ?? policy), createPolicy: agent.createPolicy });
    if (values.out !== undefined) await saveReport(values.out, report);
    display(report);
    if (values.out !== undefined) console.log("Saved " + values.out);
  } finally {
    await agent.close?.();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
