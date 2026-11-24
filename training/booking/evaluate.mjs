import assert from "node:assert/strict";
import { BOOKING_PATTERNS, bookingCases, createBooking, observeBooking, stepBooking, verifyBooking } from "../../docs/lib/booking.js";
import { benchmarkBooking, bookingReferences } from "../../docs/lib/booking-benchmark.js";
import { chooseBooking } from "../../docs/lib/booking-policy.js";

export function finish(state, decide) {
  let o = observeBooking(state);
  while (!o.done) o = stepBooking(state, decide(o));
  const score = verifyBooking(state);
  assert.deepEqual(score.violations, []);
  return score.net;
}

export function seedScores(split, model, experts) {
  const groups = new Map();
  let total = 0, count = 0;
  for (const config of bookingCases(split)) {
    const net = finish(createBooking(config), o => chooseBooking(o, model, experts));
    const pattern = BOOKING_PATTERNS[config.family];
    const group = pattern.stratum + "/" + pattern.ending;
    const bucket = groups.get(group) ?? { sum: 0, count: 0 };
    bucket.sum += net;
    bucket.count++;
    groups.set(group, bucket);
    total += net;
    count++;
  }
  return { all: total / count, byStratumEnding: Object.fromEntries([...groups].map(([key,g]) => [key,g.sum/g.count])) };
}

function unpack(group) {
  const output = { count: group.shifts, rl: group.mean };
  for (const [key, {mean, ...pair}] of Object.entries(group.references)) {
    if (key === "rl") { assert.equal(pair.delta,0); continue; }
    output[key] = mean;
    output["rlMinus" + key[0].toUpperCase() + key.slice(1)] = pair;
  }
  return output;
}

export async function scoreSplit(split, weights) {
  const refs = bookingReferences(weights);
  const report = await benchmarkBooking({ split, weights, policy: "Early booking agent", createPolicy: () => refs.rl });
  const groups = (value, fn) => Object.fromEntries(Object.entries(value).map(([key,x]) => [key,fn(x)]));
  const { all, byFamily, byStratum, byEnding, byStratumEnding } = report.summary;
  return { cases: report.cases.map(({actions, net, ...row}) => row),
    comparisons: { all: unpack(all), byFamily: groups(byFamily,unpack), byStratum: groups(byStratum,unpack),
      byEnding: groups(byEnding,unpack), byStratumEnding: groups(byStratumEnding,g => groups(g,unpack)) } };
}

export function assess(fresh, original, archive, margin) {
  const low = (g,key) => g["rlMinus" + key].interval95[0];
  const cold = g => low(g,"Stochastic") > 0 && low(g,"Survey") > -margin;
  const hotDrops = low(fresh.byStratumEnding["interrupted-drop"].hot,"Stochastic") > 0;
  const coldReversals = cold(fresh.byStratumEnding.reversal.cold);
  const archiveColdReversals = cold(archive.byStratumEnding.reversal.cold);
  const originalDrop = ["Survey","Stochastic"].every(k => low(original.all,k) > 0)
    && ["Rally","Trust","Drift","Turns"].every(k => low(original.all,k) > -margin);
  return { hotDrops, coldReversals, archiveColdReversals, originalDrop, fresh: hotDrops && coldReversals && originalDrop,
    joint: hotDrops && coldReversals && archiveColdReversals && originalDrop };
}

function emptyWave() {
  return { differing: 0, bookings: 0, waits: 0, bookingCredits: 0, waitCredits: 0, net: 0 };
}

function newComparison() {
  return { shifts: 0, differentShifts: 0, net: 0, byWave: Array.from({length:6},emptyWave) };
}

function branchReturn(state, action, learned) {
  const branch = structuredClone(state);
  stepBooking(branch, action);
  return finish(branch, learned);
}

// H(k) uses the baseline on the first k decisions and the learned policy
// thereafter. On a baseline prefix, the two forced branches yield H(k)-H(k+1).
// Summing over six waves exactly recovers each tape's whole-shift difference.
export function decisionAudit(rows, weights) {
  const refs = bookingReferences(weights), result = {};
  for (const baseline of ["survey","earlyPlanner","earlyRally"]) {
    const groups = {};
    for (const row of rows) {
      const {stratum,ending} = BOOKING_PATTERNS[row.family];
      const keys = ["all",stratum+"/"+ending];
      const counters = keys.map(k => groups[k] ??= newComparison());
      const state = createBooking(row);
      let net = 0, changed = false;
      for (let wave = 0; wave < 6; wave++) {
        const o = observeBooking(state), base = refs[baseline](o), candidate = refs.rl(o);
        if (base !== candidate) {
          changed = true;
          const diff = branchReturn(state,candidate,refs.rl) - branchReturn(state,base,refs.rl);
          net += diff;
          for (const g of counters) {
            const w = g.byWave[wave];
            w.differing++;
            if (candidate === "accept") { w.bookings++; w.bookingCredits += diff; }
            else { w.waits++; w.waitCredits += diff; }
            w.net += diff;
          }
        }
        stepBooking(state,base);
      }
      // Confirm that every tail, including at zero slots, delegates to Survey.
      while (!state.done) {
        const o = observeBooking(state), action = refs.survey(o);
        assert.equal(refs.rl(o),action);
        assert.equal(refs[baseline](o),action);
        stepBooking(state,action);
      }
      assert.equal(verifyBooking(state).net,row[baseline]);
      assert.equal(net,row.rl-row[baseline]);
      for (const g of counters) {
        g.shifts++; g.net += net;
        if (changed) g.differentShifts++;
      }
    }
    result[baseline] = groups;
  }
  return result;
}
