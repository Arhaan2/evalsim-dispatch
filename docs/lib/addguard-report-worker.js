import {ADDGUARD_SUITE,ADDGUARD_SPLITS,verifyAddGuardReport} from "./addguard-benchmark.js";
import {loadAddGuardBank} from "./addguard-study.js";
import {ADD_GUARD_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:ADDGUARD_SUITE, splits:ADDGUARD_SPLITS, verify:verifyAddGuardReport, page:"addguard", loadCaseBank:loadAddGuardBank, maxReportMiB:64, version:ADD_GUARD_CARD_VERSION});
