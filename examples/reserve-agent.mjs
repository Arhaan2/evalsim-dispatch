// A starting rule: accept a load if it meets the average of the posted future means.
// Return one available action ID. A new observation arrives at each wave.
export default function decide(observation, calls) {
  if (!calls.some(call => call.id === "accept")) return "pass";
  const { offer, forecast } = observation;
  const target = forecast.reduce((sum, entry) => sum + entry.mean, 0) / Math.max(1, forecast.length);
  return offer.net >= target ? "accept" : "pass";
}
