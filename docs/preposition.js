import {installClosureDesk} from "./lib/closure-desk.js";
import {PREPOSITION_CARD_VERSION} from "./lib/closure-scorecard.js";

installClosureDesk({page:"preposition", workerURL:new URL("./lib/preposition-report-worker.js",import.meta.url), version:PREPOSITION_CARD_VERSION});
