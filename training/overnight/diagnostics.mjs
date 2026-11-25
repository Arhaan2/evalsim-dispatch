import {createFleetWeek} from "../../docs/lib/fleetweek.js";
import {chooseFleetPlanner} from "../../docs/lib/fleetweek-planner.js";
import {fleetLedger} from "../../docs/lib/fleetweek-study.js";

const empty = id => id.split("|").some(code => code.startsWith("E"));
const bookings = id => id.split("|").map(code => code === "W" || code.startsWith("E") ? "_" : code).join("|");

function fork(config, prefix, first, decide) {
  const state = createFleetWeek(config);
  for (const id of prefix) state.step(id);
  const suffix = [first];
  state.step(first);
  while (!state.done) {
    const id = decide(state.observe(), state.legalActions());
    state.step(id);
    suffix.push(id);
  }
  return [suffix, state.ledger.net, state.ledger.served];
}

export function nightBranches(config, path, decide) {
  const state = createFleetWeek(config);
  const branches = [], overrides = [];
  for (const [epoch, id] of path.actions.entries()) {
    if (epoch % 2 === 1 && epoch < 9 && bookings(id).includes("_")) {
      const obs = state.observe(), legal = state.legalActions();
      const prefix = path.actions.slice(0,epoch);
      let other;
      if (empty(id)) {
        other = id.split("|").map(code => code.startsWith("E") ? "W" : code).join("|");
      } else {
        const alternatives = legal.filter(a => bookings(a.id) === bookings(id) && empty(a.id));
        other = chooseFleetPlanner(obs, alternatives);
      }
      const different = fork(config,prefix,other,decide);
      branches.push([epoch,id,other,...different]);
      const plannerId = chooseFleetPlanner(obs,legal);
      if (plannerId !== id) {
        if (bookings(plannerId) !== bookings(id)) throw Error("Overnight learner changed the planner's signed loads.");
        const baseline = other === plannerId ? different : fork(config,prefix,plannerId,decide);
        overrides.push([epoch,plannerId,...baseline]);
      }
    }
    state.step(id);
  }
  return {branches, overrides};
}

function counts() {
  return {nights:0,helped:0,tied:0,hurt:0,netGain:0,serviceGain:0};
}
function tally(target, net, service) {
  target.nights++;
  target[net > 0 ? "helped" : net < 0 ? "hurt" : "tied"]++;
  target.netGain += net;
  target.serviceGain += service;
}
function example(record) {
  const {row, branch, choice, netGain, serviceGain} = record;
  const [epoch,chosenId,alternativeId,suffix] = branch;
  const prefix = row.rl.actions.slice(0,epoch);
  const alternative = createFleetWeek(row);
  const actions = [...prefix,...suffix];
  for (const id of actions) alternative.step(id);
  return {family:row.family, seed:row.seed, epoch, choice, chosenId, alternativeId, prefix, chosen:row.rl,
    alternative:{actions,ledger:fleetLedger(alternative.ledger)},netGain,serviceGain};
}

export function summarizeNights(cases) {
  const report = {nights:4*cases.length,eligible:0,move:counts(),stay:counts(),
    plannerChanges:{...counts(),toMove:0,toStay:0,redirect:0}, examples:[]};
  const buckets = new Map();
  for (const row of cases) {
    for (const branch of row.branches) {
      const [,id,,,net,served] = branch;
      const choice = empty(id) ? "move" : "stay";
      const netGain = row.rl.ledger.net - net, serviceGain = row.rl.ledger.served - served;
      report.eligible++;
      tally(report[choice],netGain,serviceGain);
      if (netGain !== 0) {
        const key = choice + "/" + Math.sign(netGain);
        if (!buckets.has(key)) buckets.set(key,[]);
        buckets.get(key).push({row,branch,choice,netGain,serviceGain});
      }
    }
    for (const [epoch,plannerId,,net,served] of row.overrides) {
      const chosenMoves = empty(row.rl.actions[epoch]), plannerMoves = empty(plannerId);
      report.plannerChanges[chosenMoves && !plannerMoves ? "toMove" : !chosenMoves && plannerMoves ? "toStay" : "redirect"]++;
      tally(report.plannerChanges,row.rl.ledger.net-net,row.rl.ledger.served-served);
    }
  }
  for (const key of ["move/1","move/-1","stay/1","stay/-1"]) {
    if (!buckets.has(key)) continue;
    const candidates = buckets.get(key);
    const values=candidates.map(x=>x.netGain).sort((a,b)=>a-b);
    const median=(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;
    const pick=candidates.reduce((a,b)=>Math.abs(b.netGain-median)<Math.abs(a.netGain-median)?b:a);
    report.examples.push(example(pick));
  }
  return report;
}
