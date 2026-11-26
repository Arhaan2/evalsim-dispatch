import {SHORTDEFAULT_SUITE,SHORTDEFAULT_SPLITS,verifyShortDefaultReport} from "./shortdefault-benchmark.js";
import {SHORT_DEFAULT_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:SHORTDEFAULT_SUITE, splits:SHORTDEFAULT_SPLITS, verify:verifyShortDefaultReport, page:"shortdefault", version:SHORT_DEFAULT_CARD_VERSION});
