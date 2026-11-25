import {verifyUncertaintyReport, UNCERTAINTY_SPLITS} from "./uncertainty-benchmark.js";
import {installStudyWorker} from "./fleet-study-worker.js";

installStudyWorker({directory:"uncertainty",splits:UNCERTAINTY_SPLITS,verify:verifyUncertaintyReport});
