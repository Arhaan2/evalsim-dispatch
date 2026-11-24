import { mountOneSlotDesk } from "./lib/one-slot-desk.js";
import { LASTSLOT_SUITE, LASTSLOT_PATTERNS, PRICE_CENTS, createLastslot, observeLastslot, stepLastslot, verifyLastslot } from "./lib/lastslot.js";
import { decodeLastslotCase, lastslotReferences } from "./lib/lastslot-benchmark.js";
import { lastslotDecision } from "./lib/lastslot-policy.js";

mountOneSlotDesk({
  suite:LASTSLOT_SUITE, patterns:LASTSLOT_PATTERNS, priceCentsList:PRICE_CENTS,
  world:{create:createLastslot, observe:observeLastslot, step:stepLastslot, verify:verifyLastslot},
  decodeCase:decodeLastslotCase, references:lastslotReferences, agentDecision:lastslotDecision,
  checkpoint:"lastslot", deskURL:new URL("./data/lastslot/desk.json",import.meta.url), workerURL:new URL("./lib/lastslot-report-worker.js",import.meta.url),
  names:{
    rl:"Last-slot agent", rlNever:"Agent · always skip", planner:"Price-aware planner", rlAlways:"Agent · forced buy",
    tariff:"Survey pricing", paid:"One-credit survey", stochastic:"Original planner", booking:"Booking",
    survey:"Survey", rally:"Rally", trust:"Trust", drift:"Drift", turns:"Turns"
  }
});
