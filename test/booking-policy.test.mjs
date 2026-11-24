import assert from "node:assert/strict";
import test from "node:test";
import { bookingContext, bookingDecision, bookingKeys, chooseBooking, earlyValues } from "../docs/lib/booking-policy.js";
import { surveyDecision } from "../docs/lib/survey-policy.js";
import { fitEarlyCandidate } from "../training/booking/fit.mjs";

const quote = { highChance: 0.7, high: 19, low: 7 };
function observation(wave, slots = 2, signed = 7) {
  return { wave, slots, done: false, quote, offer: { net: signed },
    history: Array.from({ length: wave }, (_, i) => ({ wave: i, high: i === 1, quote })) };
}

test("prices are known and the two feasible actions have capacity-specific continuation returns", () => {
  const model = { tables: Array(6).fill({ "*": [9,15] }) };
  assert.deepEqual(bookingDecision(observation(3,1),model,{}),
    { action:"pass", phase:"early", advantage:-2, bookValue:7, waitValue:9 });
  assert.deepEqual(bookingDecision(observation(3,2),model,{}),
    { action:"accept", phase:"early", advantage:1, bookValue:16, waitValue:15 });
  assert.equal(chooseBooking(observation(3,0),model,{}), "pass");
  assert.equal(chooseBooking({ done:true },model,{}), null);
  assert.equal(chooseBooking(observation(2,1,19),{ tables:Array(6).fill({ "*":[19,36] }) },{}), "accept");
});

test("public signed offers and the wave-four bulletin enter staged backoff", () => {
  const o = observation(3,1,19);
  const context = bookingContext(o);
  assert.deepEqual(context,{ wave:3,low:7,high:19,odds:7,signs:10 });
  assert.equal(bookingContext(observation(2)).odds,0);
  const keys = bookingKeys(context);
  assert.deepEqual(earlyValues({ "*":[0,0], [keys[3]]:[1,2] },context), [1,2]);
  assert.throws(() => earlyValues({},context), /missing/);
});

test("the last two decisions exactly inherit frozen Survey at the current residual capacity", () => {
  const survey = { kind:"always", returns:Array(8).fill({ "*":[1,13,7,1,11,6] }) };
  for (const wave of [6,7]) for (const slots of [0,1,2]) {
    const o=observation(wave,slots);
    const d=bookingDecision(o,null,{ survey }), previous=surveyDecision(o,survey);
    assert.equal(d.action,previous.action);
    assert.equal(d.advantage,previous.advantage);
    assert.equal(d.phase,"late");
    assert.equal(d.waitValue,null);
  }
});

test("backward targets roll the same two tapes through both truck counts", () => {
  const data = {
    n:2, groups:[0,0], groupCounts:[2,0,0,0], tailOne:[12,4], tailTwo:[20,20],
    layers:Array.from({ length:6 }, (_, wave) => ({
      ids:[0,0], leaves:[0], nodes:[{ key:"*",parent:-1 }], prices:wave === 5 ? [10,10] : [11,11],
    })),
  };
  const model=fitEarlyCandidate(data,{ id:"toy",masses:null });
  assert.deepEqual(model.tables[5]["*"],[8,20]);
  // With one slot at wave six, collect 10. With two slots keep the frozen
  // tail, worth 20. On the preceding wave, the two-slot best action flips.
  assert.deepEqual(model.tables[4]["*"],[10,20]);
  assert.deepEqual(model.tables[3]["*"],[11,21]);
});
