import assert from "node:assert/strict";
import test from "node:test";
import { chooseSurvey, forecastPath, mixSlotCosts, returnPath, surveyDecision, surveyEvidence } from "../docs/lib/survey-policy.js";

const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-9, a + " versus " + b);
function observation(wave = 6, q = 0.8, slots = 1) {
  const quote = highChance => ({ low: 9, high: 21, highChance });
  return { wave, slots, done: false, quote: quote(q), offer: { net: 21 },
    history: Array.from({ length: wave }, (_, i) => ({ wave: i, high: i % 2 === 0, quote: quote(i >= 3 ? 0.3 : 0.5) })) };
}
function model(kind, p = 0.2) {
  return { kind, forecast: Array.from({ length: 8 }, () => ({ raw: { "*": 0.45 }, curve: Array(10).fill(p) })),
    returns: Array.from({ length: 8 }, () => ({ "*": [1, 10, 8, 1, 30, 25] })) };
}

test("the learned error forecast genuinely changes booking at a fixed signed offer and survey", () => {
  const o = observation();
  const discounted = surveyDecision(o, model("learned")), trusted = surveyDecision(o, model("always"));
  close(discounted.misleading, 0.8);
  close(discounted.advantage, 7);
  close(trusted.misleading, 0.2);
  close(trusted.advantage, -5);
  assert.deepEqual([discounted.action, trusted.action], ["accept", "pass"]);
  const weighted = mixSlotCosts(0.5, [2, 7, 4, 6, 23, 14]);
  close(weighted.hotBookingWeight, 0.75);
  close(weighted.one, 19);
  close(weighted.two, 11.5);
});
test("error probabilities use only directional delayed bulletins and forecasts remain available at capacity", () => {
  const predictor = model("learned", 0.73);
  for (const [wave, q, probability] of [[2,0.4,null], [3,0.5,null], [5,0.2,0.73], [7,0.8,0.27]]) {
    const d = surveyDecision(observation(wave,q,0), predictor);
    close(d.persistence,0.73);
    if (probability === null) assert.equal(d.misleading,null);
    else close(d.misleading,probability);
    assert.equal(d.action,"pass");
    assert.equal(d.advantage,null);
  }
  assert.equal(chooseSurvey({ done: true }, predictor),null);
});
test("never-trust action and persistence are independent of current and previous survey values", () => {
  const o = observation(), predictor = model("never");
  const clean = surveyDecision(o, predictor);
  const altered = observation(6,0.2);
  for (const entry of altered.history) entry.quote.highChance = 0.9;
  const second = surveyDecision(altered, predictor);
  assert.deepEqual([second.action, second.advantage, second.persistence], [clean.action, clean.advantage, clean.persistence]);
  assert.notEqual(second.misleading, clean.misleading);
  for (const quote of [o.quote, ...o.history.map(x => x.quote)]) {
    Object.defineProperty(quote, "highChance", { get() { throw new Error("never-trust decision read a survey"); } });
  }
  assert.equal(chooseSurvey(o, predictor),clean.action);
});
test("history encoding and return lookup use only the signed prefix and never peek at future bulletins", () => {
  const o = observation(), e = surveyEvidence(o);
  assert.equal(e.first,3);
  assert.equal(e.second,8);
  assert.equal(e.bits, 1 + 4 + 16 + 64);
  Object.defineProperty(o, "forecast", { get() { throw new Error("unneeded future bulletin"); } });
  const m = model("learned"), key = forecastPath(e,true).at(-1);
  m.forecast[6].raw[key] = 0.8;
  m.forecast[6].curve[8] = 0.93;
  m.returns[6][returnPath(e,true).at(-1)] = [1,0,0,1,0,0];
  const d = surveyDecision(o,m);
  close(d.persistence,0.93);
  close(d.advantage,21);
});
