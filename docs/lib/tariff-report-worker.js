import { verifyTariffReport } from "./tariff-benchmark.js";

self.onmessage = async ({ data }) => {
  try {
    await verifyTariffReport(data.report, data.weights);
    self.postMessage({ verified: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
