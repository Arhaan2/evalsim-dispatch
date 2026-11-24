// A simple outside policy. Pay up to ten cents when exactly one truck slot remains.
import freight from "./paid-agent.mjs";
export default function decide(observation,calls) {
  if (observation.phase === "survey") return observation.slots === 1 && observation.priceCents <= 10 ? "buy" : "skip";
  return freight(observation,calls);
}
