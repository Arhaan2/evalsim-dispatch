import {installClosureDesk} from "./lib/closure-desk.js";
import {LONG_MOVE_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"longmove", workerURL:new URL("./lib/longmove-report-worker.js",import.meta.url), version:LONG_MOVE_CARD_VERSION});
