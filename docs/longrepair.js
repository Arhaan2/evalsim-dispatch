import {installClosureDesk} from "./lib/closure-desk.js";
import {LONG_REPAIR_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"longrepair", workerURL:new URL("./lib/longrepair-report-worker.js",import.meta.url), version:LONG_REPAIR_CARD_VERSION});
