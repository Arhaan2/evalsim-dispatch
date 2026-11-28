import {installClosureDesk} from "./lib/closure-desk.js";
import {ADD_GUARD_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"addguard", workerURL:new URL("./lib/addguard-report-worker.js",import.meta.url), version:ADD_GUARD_CARD_VERSION});
