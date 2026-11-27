import {installClosureDesk} from "./lib/closure-desk.js";
import {MOVE_RECALL_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"moverecall", workerURL:new URL("./lib/moverecall-report-worker.js",import.meta.url), version:MOVE_RECALL_CARD_VERSION});
