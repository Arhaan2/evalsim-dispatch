import {installReportDesk} from "./lib/fleet-report-desk.js";
import {installCaseDesk} from "./lib/fleet-case-desk.js";

installCaseDesk();
installReportDesk({
  workerUrl: new URL("./lib/loss-report-worker.js", import.meta.url),
  agentName: "Loss-aware agent",
  comparator: {key: "flatRisk", name: "Constant penalty"}
});
