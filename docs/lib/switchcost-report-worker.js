import {SWITCHCOST_SUITE,SWITCHCOST_SPLITS,verifySwitchCostReport} from "./switchcost-benchmark.js";
import {SWITCH_COST_CARD_VERSION} from "./closure-scorecard.js";
import {installClosureReportWorker} from "./closure-report-desk.js";

installClosureReportWorker({suite:SWITCHCOST_SUITE, splits:SWITCHCOST_SPLITS, verify:verifySwitchCostReport, page:"switchcost", version:SWITCH_COST_CARD_VERSION});
