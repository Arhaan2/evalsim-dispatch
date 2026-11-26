import {FLEET_DEPOTS} from "./fleetweek.js";
import {createClosureWeek} from "./closure-world.js";
import {dispatchText, roundName} from "./overnight-view.js";

export function incidentText(incident) {
  if (incident.status === "clear") return "All depots open";
  const depot = FLEET_DEPOTS[incident.depot];
  if (incident.status === "warning") return depot + " will close " + roundName(incident.start);
  if (incident.status === "reopened") return depot + " reopened";
  const update = incident.update === "delayed" ? " · repairs delayed" : incident.update === "on-track" ? " · repairs on track" : "";
  return depot + " closed" + update;
}
export function traceClosure(config, actions) {
  if (!Array.isArray(actions) || actions.length !== 10) throw Error("A closure replay needs ten decisions.");
  const world = createClosureWeek(config), trace = [];
  for (const id of actions) {
    const observation = world.observe(), {action,ledger} = world.step(id);
    trace.push({observation,action,ledger});
  }
  return {trace, ledger:world.ledger};
}

export function replayWeek(row, actions, baselineKeys=["planner","flatRisk"]) {
  const paths = [actions, ...baselineKeys.map(k=>row[k].actions), row.rl.actions].map(ids=>traceClosure(row,ids));
  return {family:row.family, seed:row.seed, ledgers:paths.map(path=>path.ledger),
    rounds:paths[0].trace.map(({observation},t)=>[roundName(t),incidentText(observation.incident),
      ...paths.map(run=>dispatchText(run.trace[t]) + " · " + run.trace[t].action.net + " net")])};
}
