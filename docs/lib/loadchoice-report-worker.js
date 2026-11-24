import { LOADCHOICE_EVALUATION_SPLITS, verifyLoadchoiceReport } from "./loadchoice-benchmark.js";

self.onmessage = async ({ data }) => {
  try {
    const split = data.report?.split;
    if (!LOADCHOICE_EVALUATION_SPLITS.includes(split)) throw new Error("Unknown public evaluation split.");
    const response = await fetch(new URL("../data/loadchoice/" + split + ".json",import.meta.url));
    if (!response.ok) throw new Error("The published reference scores could not be loaded.");
    const bytes = await response.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    const hex = Array.from(digest,b => b.toString(16).padStart(2,"0")).join("");
    if (hex !== data.weights.bankDigests[split]) throw new Error("The reference bank differs from the published release. Reload and try again.");
    const bank = JSON.parse(new TextDecoder().decode(bytes));
    await verifyLoadchoiceReport(data.report, data.weights.weights, bank);
    self.postMessage({ verified: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
