import {installReportDesk} from "./lib/fleet-report-desk.js";
import {installCaseDesk} from "./lib/fleet-case-desk.js";

installCaseDesk();
installReportDesk({workerUrl:new URL("./lib/overnight-report-worker.js",import.meta.url),agentName:"Overnight agent"});
