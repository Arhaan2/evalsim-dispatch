import { verifySurveyReport } from "./survey-benchmark.js";

self.onmessage = async ({ data }) => {
  try {
    await verifySurveyReport(data.report, data.weights);
    self.postMessage({ verified: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
