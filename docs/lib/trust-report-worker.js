import { verifyTrustReport } from "./trust-benchmark.js";

self.onmessage = async ({ data }) => {
  try {
    await verifyTrustReport(data.report, data.weights);
    self.postMessage({ verified: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
