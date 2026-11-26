import {CLOSURE_SUITE,CLOSURE_SPLITS,verifyClosureReport} from "./closure-benchmark.js";
import {CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:CLOSURE_SUITE, splits:CLOSURE_SPLITS, verify:verifyClosureReport, page:"closure", version:CARD_VERSION});
