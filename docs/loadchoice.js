import { mountOneSlotDesk } from "./lib/one-slot-desk.js";
import { LOADCHOICE_SUITE, LOADCHOICE_PATTERNS, PRICE_CENTS, createLoadchoice, observeLoadchoice, stepLoadchoice, verifyLoadchoice } from "./lib/loadchoice.js";
import { decodeLoadchoiceCase, loadchoiceReferences } from "./lib/loadchoice-benchmark.js";
import { loadchoiceDecision } from "./lib/loadchoice-policy.js";
import { loadEvidence } from "./lib/loadchoice-view.js";

mountOneSlotDesk({
  suite:LOADCHOICE_SUITE, patterns:LOADCHOICE_PATTERNS, priceCentsList:PRICE_CENTS,
  world:{create:createLoadchoice, observe:observeLoadchoice, step:stepLoadchoice, verify:verifyLoadchoice},
  decodeCase:decodeLoadchoiceCase, references:loadchoiceReferences, agentDecision:loadchoiceDecision,
  checkpoint:"loadchoice", deskURL:new URL("./data/loadchoice/desk.json",import.meta.url), workerURL:new URL("./lib/loadchoice-report-worker.js",import.meta.url),
  loadStudyDetails:loadEvidence, extraMargins:{lastslot:-1},
  names:{
    rl:"Load-choice agent", rlNever:"Agent · always skip", planner:"Price-aware planner", rlAlways:"Agent · forced buy",
    lastslot:"Previous one-slot agent", tariff:"Survey pricing", paid:"One-credit survey", stochastic:"Original planner", booking:"Booking",
    survey:"Survey", rally:"Rally", trust:"Trust", drift:"Drift", turns:"Turns"
  }
});
