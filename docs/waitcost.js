import { mountOneSlotDesk } from "./lib/one-slot-desk.js";
import { WAITCOST_SUITE, WAITCOST_PATTERNS, PRICE_CENTS, createWaitcost, observeWaitcost, stepWaitcost, verifyWaitcost } from "./lib/waitcost.js";
import { decodeWaitcostCase, waitcostReferences } from "./lib/waitcost-benchmark.js";
import { waitcostDecision } from "./lib/waitcost-policy.js";
import { waitEvidence, explainGuard } from "./lib/waitcost-view.js";

mountOneSlotDesk({
  suite:WAITCOST_SUITE, patterns:WAITCOST_PATTERNS, priceCentsList:PRICE_CENTS,
  world:{create:createWaitcost, observe:observeWaitcost, step:stepWaitcost, verify:verifyWaitcost},
  decodeCase:decodeWaitcostCase, references:waitcostReferences, agentDecision:waitcostDecision,
  checkpoint:"waitcost", deskURL:new URL("./data/waitcost/desk.json",import.meta.url), workerURL:new URL("./lib/waitcost-report-worker.js",import.meta.url),
  loadStudyDetails:waitEvidence, freightExplanation:explainGuard, extraMargins:{loadchoice:-1,lastslot:-1},
  primaryRule:"Cold reversals require both lower bounds above zero. Keeping the hot-drop win requires a positive lower bound against the planner.",
  names:{
    rl:"Agent with wait check", rlNever:"Agent · always skip", planner:"Price-aware planner", rlAlways:"Agent · forced buy",
    loadchoice:"Previous load-choice agent", unguarded:"Same purchases, previous freight rule", unguardedAlways:"Forced buy, previous freight rule",
    alwaysStop:"Same purchases, always stop waiting", alwaysStopForced:"Forced buy, always stop waiting",
    lastslot:"Previous one-slot agent", tariff:"Survey pricing", paid:"One-credit survey", stochastic:"Original planner", booking:"Booking",
    survey:"Survey", rally:"Rally", trust:"Trust", drift:"Drift", turns:"Turns"
  }
});
