import { verifyPaidReport } from "./paid-benchmark.js";

self.onmessage = async ({ data }) => {
  try {
    await verifyPaidReport(data.report, data.weights);
    self.postMessage({ verified: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
