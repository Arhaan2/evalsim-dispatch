import {LONGREPAIR_SUITE,LONGREPAIR_SPLITS,verifyLongRepairReport} from "./longrepair-benchmark.js";
import {LONG_REPAIR_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:LONGREPAIR_SUITE, splits:LONGREPAIR_SPLITS, verify:verifyLongRepairReport, page:"longrepair", version:LONG_REPAIR_CARD_VERSION});
