import {installReportDesk} from "./lib/fleet-report-desk.js";
import {installCaseDesk} from "./lib/fleet-case-desk.js";

installCaseDesk();
installReportDesk({workerUrl:new URL("./lib/uncertainty-report-worker.js",import.meta.url),agentName:"Risk-aware agent"});
