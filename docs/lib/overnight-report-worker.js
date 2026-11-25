import {verifyOvernightReport, OVERNIGHT_SPLITS} from "./overnight-benchmark.js";
import {installStudyWorker} from "./fleet-study-worker.js";

installStudyWorker({directory:"overnight",splits:OVERNIGHT_SPLITS,verify:verifyOvernightReport});
