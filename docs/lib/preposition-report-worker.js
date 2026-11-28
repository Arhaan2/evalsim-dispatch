import {PREPOSITION_SUITE,PREPOSITION_SPLITS,verifyPrepositionReport} from "./preposition-benchmark.js";
import {loadPrepositionBank} from "./preposition-study.js";
import {PREPOSITION_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:PREPOSITION_SUITE, splits:PREPOSITION_SPLITS, verify:verifyPrepositionReport, page:"preposition", loadCaseBank:loadPrepositionBank, maxReportMiB:64, version:PREPOSITION_CARD_VERSION});
