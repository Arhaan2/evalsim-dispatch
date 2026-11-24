// A simple policy you can replace with your own. All calls have the same cost in time here
// except wait, which advances to the next dispatch window.
export default function earliestDeadline(observation, calls) {
  const earliest = observation.orders.map((order, i) => ({ ...order, index: i }))
    .filter(order => !order.assigned).sort((a, b) => a.deadline - b.deadline);
  for (const order of earliest) {
    for (const carrier of ["express", "local"]) {
      const id = carrier + "-" + order.index;
      if (calls.some(call => call.id === id)) return id;
    }
  }
  return "wait";
}
