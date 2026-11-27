import {MOVERECALL_SUITE,MOVERECALL_SPLITS,verifyMoveRecallReport} from "./moverecall-benchmark.js";
import {MOVE_RECALL_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:MOVERECALL_SUITE, splits:MOVERECALL_SPLITS, verify:verifyMoveRecallReport, page:"moverecall", version:MOVE_RECALL_CARD_VERSION});
