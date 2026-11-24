import { TARIFF_PATTERNS, TARIFF_SUITE, tariffCases, createTariff, observeTariff, stepTariff, verifyTariff, tariffCalls } from "./tariff.js";
import { chooseTariff, chooseTariffPlanner } from "./tariff-policy.js";
import { paidWeights, paidReferences } from "./paid-benchmark.js";
import { pairedReserve } from "./reserve-policy.js";

export const TARIFF_REPORT = "evalsim-tariff-report-v1";
export const TARIFF_EVALUATION_SPLITS = Object.freeze(["validation","test","retention","archive"]);
export const tariffWeights = (release,...prior) => ({ ...paidWeights(...prior), tariff:release.checkpoint.weights });

const legacyKeys = ["stochastic","booking","survey","rally","trust","drift","turns"];
export function tariffReferences(weights) {
  const previous = paidReferences(weights);
  const learned = mode => o => chooseTariff(o,weights.tariff,mode);
  const planner = mode => o => chooseTariffPlanner(o,weights.tariff,mode);
  return { rl:learned("optional"), planner:planner("optional"), rlNever:learned("never"), rlAlways:learned("always"),
    plannerNever:planner("never"), plannerAlways:planner("always"), paid:previous.rl,
    ...Object.fromEntries(legacyKeys.map(k => [k,previous[k]])) };
}

export async function runTariffCase(config, decide) {
  if (typeof decide !== "function") throw new TypeError("Expected a policy function.");
  const state = createTariff(config), actions = [];
  while (!state.done) {
    const o = observeTariff(state);
    const action = await decide(o,tariffCalls(o));
    stepTariff(state,action);
    actions.push(action);
  }
  const score = verifyTariff(state);
  if (score.violations.length || score.grossCents - score.feeCents !== score.netCents) throw new Error("Tariff ledger failed to reconcile.");
  return { actions, score };
}

function by(rows, keyOf, fn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups].map(([key,group]) => [key,fn(group)]));
}

export function summarizeTariff(cases, referenceKeys) {
  // Compute paired differences in integer cents. Bootstrap units are whole
  // seeds, so every repeated price and sibling ending stays with its tape.
  const cents = cases.map(row => ({ seed:row.seed,family:row.family,priceCents:row.priceCents,
    bought:row.bought, purchased:row.actions[5] === "buy", net:row.netCents,
    ...Object.fromEntries(referenceKeys.map(k => [k,Math.round(100*row[k])])) }));
  const group = rows => {
    const n = rows.length, seedCounts=new Set(), tapes=new Set();
    let sum=0,fees=0,bought=0;
    for (const row of rows) {
      seedCounts.add(row.seed); tapes.add(row.seed+"/"+row.family); sum+=row.net;
      if (row.purchased) { bought++; fees+=row.priceCents; }
    }
    const references={};
    for (const [i,k] of referenceKeys.entries()) {
      let net=0,count=0,charges=0;
      for (const row of rows) {
        net+=row[k];
        if (row.bought[i]) { count++; charges+=row.priceCents; }
      }
      const pair=pairedReserve(rows,"net",k);
      references[k]={ mean:net/(100*n), bought:count, fees:charges/100, ...pair,
        delta:pair.delta/100, interval95:pair.interval95.map(v=>v/100) };
    }
    return { shifts:n,tapes:tapes.size,seeds:seedCounts.size,mean:sum/(100*n),bought,fees:fees/100,references };
  };
  const stratum=r=>TARIFF_PATTERNS[r.family].stratum, ending=r=>TARIFF_PATTERNS[r.family].ending;
  const joint=rows=>by(rows,stratum,part=>by(part,ending,group));
  return { all:group(cents), byFamily:by(cents,r=>r.family,group), byStratum:by(cents,stratum,group),
    byEnding:by(cents,ending,group), byStratumEnding:joint(cents), positive:group(cents.filter(r=>r.priceCents>0)),
    byPrice:by(cents,r=>r.priceCents,part=>({all:group(part),byStratumEnding:joint(part)})) };
}

export async function benchmarkTariff({split="test",policy,createPolicy,weights}) {
  if (!TARIFF_EVALUATION_SPLITS.includes(split)) throw new RangeError("Unknown tariff split.");
  if (typeof policy !== "string" || !policy.trim() || policy.length>160) throw new Error("Use a policy name of 1–160 characters.");
  const references=Object.entries(tariffReferences(weights)), cases=[];
  // These historical policies always skip; price changes neither their
  // actions nor their earnings. Reuse only scores from this very freight tape.
  let lastTape, history=new Map();
  for (const config of tariffCases(split)) {
    const {seed,family,priceCents}=config;
    try {
      const tape=seed+"/"+family;
      if (tape!==lastTape) { history=new Map(); lastTape=tape; }
      const {actions,score}=await runTariffCase(config,createPolicy());
      const row={seed,family,priceCents,actions,net:score.net,gross:score.gross,feePaid:score.feePaid,
        netCents:score.netCents,grossCents:score.grossCents,feeCents:score.feeCents,reading:score.reading,bought:[]};
      for (const [key,decide] of references) {
        let result=history.get(key);
        if (!result) {
          result=(await runTariffCase(config,decide)).score;
          if (legacyKeys.includes(key)) history.set(key,result);
        }
        row[key]=result.net; row.bought.push(result.bought);
      }
      cases.push(row);
    } catch (err) { throw new Error(family+" shift "+seed+" at "+priceCents+" cents: "+err.message,{cause:err}); }
  }
  return { format:TARIFF_REPORT,suite:TARIFF_SUITE.id,split,policy,
    summary:summarizeTariff(cases,references.map(([k])=>k)),cases };
}

function same(a,b) {
  if (a===b) return true;
  if (!a || !b || typeof a!=="object" || typeof b!=="object" || Array.isArray(a)!==Array.isArray(b)) return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k) && same(a[k],b[k]));
}

export async function verifyTariffReport(report,weights) {
  if (report?.format!==TARIFF_REPORT || report.suite!==TARIFF_SUITE.id || !TARIFF_EVALUATION_SPLITS.includes(report.split)) {
    throw new Error("Unrecognized tariff report or suite version.");
  }
  const manifest=tariffCases(report.split);
  if (!Array.isArray(report.cases) || report.cases.length!==manifest.length) throw new Error("Incomplete tariff split.");
  for (const [i,config] of manifest.entries()) {
    const row=report.cases[i];
    if (row?.seed!==config.seed || row.family!==config.family || row.priceCents!==config.priceCents || !Array.isArray(row.actions) || row.actions.length!==9) {
      throw new Error("A reported price, tape or action list differs from the fixed manifest.");
    }
  }
  let i=0;
  const rebuilt=await benchmarkTariff({split:report.split,policy:report.policy,weights,createPolicy(){
    const actions=report.cases[i++].actions;
    let j=0;
    return ()=>actions[j++];
  }});
  if (!same(rebuilt,report)) throw new Error("Reported charges, readings, decisions or scores differ from replay.");
  return rebuilt;
}
