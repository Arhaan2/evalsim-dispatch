import { FLEET_DEPOTS, runFleetWeek } from "./fleetweek.js";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const loads = {C:"Contract", S0:"Spot A", S1:"Spot B"};
export const roundName = t => days[Math.floor(t / 2)] + (t % 2 ? " afternoon" : " morning");
export const familyName = family => family.split("-").map((s,i)=>i ? s : s.charAt(0).toUpperCase()+s.slice(1)).join(" ");
export function traceActions(config, actions) {
  return runFleetWeek(config, obs => actions[obs.epoch]);
}
export function moveName(code, obs, i) {
  if (code === "W") return "Wait at " + FLEET_DEPOTS[obs.positions[i]];
  if (code[0] === "E") return "Move empty to " + FLEET_DEPOTS[Number(code[1])];
  const order = obs.orders.find(o=>o.id === code);
  return loads[code] + " to " + FLEET_DEPOTS[order.destination];
}
export function dispatchText(frame) {
  return frame.action.moves.map((code,i)=>moveName(code, frame.observation, i)).join(" / ");
}
export function branchLabel(frame) {
  const idle = frame.action.moves.flatMap((code,i) =>
    code === "W" || code[0] === "E" ? [{code,i}] : []);
  return idle.map(({code,i}) => (idle.length>1 ? "Truck "+(i+1)+" · " : "") + moveName(code,frame.observation,i)).join(" / ");
}
