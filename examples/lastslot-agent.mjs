// Baseline for outside agents: buy only when the price is at most five cents
// and one slot remains, then let the six-sample reading guide the next booking.
import freight from "./paid-agent.mjs";

export default function decide(observation,calls) {
  if(observation.phase==="survey") {
    return observation.slots===1 && observation.priceCents<=5 ? "buy" : "skip";
  }
  return freight(observation,calls);
}
