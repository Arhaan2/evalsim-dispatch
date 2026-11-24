import { createFreightBenchmark } from "./freight-benchmark.js";
import { BOOKING_SUITE, BOOKING_PATTERNS, bookingCases, createBooking, observeBooking, stepBooking, verifyBooking } from "./booking.js";
import { chooseBooking } from "./booking-policy.js";
import { surveyWeights, surveyReferences } from "./survey-benchmark.js";

export const BOOKING_REPORT = "evalsim-booking-report-v1";
export const BOOKING_EVALUATION_SPLITS = Object.freeze(["validation", "test", "retention", "archive"]);

export function bookingWeights(release, ...priorReleases) {
  const { weights, equalWeights } = release.checkpoint;
  return { ...surveyWeights(...priorReleases), booking: weights, equal: equalWeights };
}

export function bookingReferences(weights) {
  const { rl: survey, ...previous } = surveyReferences(weights);
  return {
    rl: o => chooseBooking(o, weights.booking, weights),
    equal: o => chooseBooking(o, weights.equal, weights),
    earlyPlanner: o => o.wave < 6 ? previous.stochastic(o) : survey(o),
    earlyRally: o => o.wave < 6 ? previous.rally(o) : survey(o),
    survey, ...previous,
  };
}

export const { runCase: runBookingCase, benchmark: benchmarkBooking, verifyReport: verifyBookingReport } =
  createFreightBenchmark({
    id: BOOKING_SUITE.id, format: BOOKING_REPORT, cases: bookingCases, references: bookingReferences,
    splits: BOOKING_EVALUATION_SPLITS, stratum: family => BOOKING_PATTERNS[family].stratum,
    ending: family => BOOKING_PATTERNS[family].ending,
    world: { create: createBooking, observe: observeBooking, step: stepBooking, verify: verifyBooking },
  });
