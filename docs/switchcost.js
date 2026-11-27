import {installClosureDesk} from "./lib/closure-desk.js";
import {SWITCH_COST_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"switchcost", workerURL:new URL("./lib/switchcost-report-worker.js",import.meta.url), version:SWITCH_COST_CARD_VERSION});
