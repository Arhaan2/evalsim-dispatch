import {FRIDAYGUARD_SUITE,FRIDAYGUARD_SPLITS,verifyFridayGuardReport} from "./fridayguard-benchmark.js";
import {loadFridayGuardBank} from "./fridayguard-study.js";
import {FRIDAY_GUARD_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:FRIDAYGUARD_SUITE, splits:FRIDAYGUARD_SPLITS, verify:verifyFridayGuardReport, page:"fridayguard", loadCaseBank:loadFridayGuardBank, maxReportMiB:64, version:FRIDAY_GUARD_CARD_VERSION});
