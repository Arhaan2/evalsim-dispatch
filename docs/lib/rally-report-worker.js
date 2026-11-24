import { verifyRallyReport } from "./rally-benchmark.js";

self.onmessage = async ({ data }) => {
  try {
    await verifyRallyReport(data.report, data.weights);
    self.postMessage({ verified: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
