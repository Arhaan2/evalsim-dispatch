import {installClosureDesk} from "./lib/closure-desk.js";
import {CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"closure", workerURL:new URL("./lib/closure-report-worker.js",import.meta.url), version:CARD_VERSION});
