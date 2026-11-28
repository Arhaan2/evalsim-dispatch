import {installClosureDesk} from "./lib/closure-desk.js";
import {FRIDAY_GUARD_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"fridayguard", workerURL:new URL("./lib/fridayguard-report-worker.js",import.meta.url), version:FRIDAY_GUARD_CARD_VERSION});
