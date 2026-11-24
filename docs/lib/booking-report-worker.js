import { verifyBookingReport } from "./booking-benchmark.js";

self.onmessage = async ({ data }) => {
  try {
    await verifyBookingReport(data.report, data.weights);
    self.postMessage({ verified: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
