import {verifyLossReport, LOSS_SPLITS} from "./loss-benchmark.js";
import {installStudyWorker} from "./fleet-study-worker.js";

installStudyWorker({directory:"loss", splits:LOSS_SPLITS, verify:verifyLossReport, extraReference:"flatRisk"});
