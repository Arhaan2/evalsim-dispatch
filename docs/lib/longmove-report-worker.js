import {LONGMOVE_SUITE,LONGMOVE_SPLITS,verifyLongMoveReport} from "./longmove-benchmark.js";
import {LONG_MOVE_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:LONGMOVE_SUITE, splits:LONGMOVE_SPLITS, verify:verifyLongMoveReport, page:"longmove", version:LONG_MOVE_CARD_VERSION});
