// The new return learner compiles to the same public one-slot decision table
// as Last Slot. Keeping the lookup common also keeps forced-buy and forced-skip
// controls identical everywhere except the acquisition decision and its reading.
export { chooseLastslot as chooseLoadchoice, lastslotDecision as loadchoiceDecision } from "./lastslot-policy.js";
