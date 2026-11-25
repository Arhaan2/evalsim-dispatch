import {verifyOverrideReport, OVERRIDE_SPLITS} from "./override-benchmark.js";
import {installStudyWorker} from "./fleet-study-worker.js";

installStudyWorker({directory:"override",splits:OVERRIDE_SPLITS,verify:verifyOverrideReport});
