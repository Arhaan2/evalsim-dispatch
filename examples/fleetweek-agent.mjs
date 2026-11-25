// Both truck moves must be legal together. Pick the largest immediate net payout.
export default function dispatch(observation, calls) {
  return calls.reduce((best, next) => next.net > best.net ? next : best).id;
}
