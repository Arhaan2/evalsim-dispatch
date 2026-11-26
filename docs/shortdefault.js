import {installClosureDesk} from "./lib/closure-desk.js";
import {SHORT_DEFAULT_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"shortdefault", workerURL:new URL("./lib/shortdefault-report-worker.js",import.meta.url), version:SHORT_DEFAULT_CARD_VERSION});
