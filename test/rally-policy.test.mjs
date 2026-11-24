import test from "node:test";
import assert from "node:assert/strict";
import { chooseRally, rallyDecision } from "../docs/lib/rally-policy.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + " vs " + expected);
const quote = (low, high, highChance = 0.4) => ({ low, high, highChance });
function view(board, flags, slots = 1) {
  const wave = flags.length - 1;
  return {
    done: false, slots, wave, quote: board[wave],
    offer: { net: flags[wave] ? board[wave].high : board[wave].low },
    history: flags.slice(0, wave).map((high, i) => ({ wave: i, high, quote: board[i] })),
    forecast: board.slice(wave + 1).map(q => ({ ...q, highChance: board[wave].highChance })),
  };
}

test("booking values integrate the information in the next offer", () => {
  const board = [quote(12, 26), quote(10, 20), quote(0, 50)];
  const weights = { kind: "latent", components: [
    { prior: 0.5, hot: true, signedHigh: [0.5, 0.9, 0.95], surveys: [] },
    { prior: 0.5, hot: false, signedHigh: [0.5, 0.1, 0.05], surveys: [] },
  ] };
  // Next high: 90% hot, E[last] = 43, pass 20. Next low: 10% hot,
  // E[last] = 7, book 10. Thus holding one slot is worth (43+10)/2.
  const opening = view(board, [true]);
  near(rallyDecision(opening, weights).advantage, 26 - 26.5);
  assert.equal(chooseRally(opening, weights), "pass");
  near(rallyDecision({ ...opening, slots: 2 }, weights).advantage, 26 + 26.5 - 40);
  assert.equal(chooseRally({ ...opening, slots: 2 }, weights), "accept");
  const afterLow = rallyDecision(view(board, [true, false]), weights);
  near(afterLow.persistence, 0.1);
  near(afterLow.advantage, 3);
  near(rallyDecision(view(board, [true, true]), weights).persistence, 0.9);
});

test("a delayed survey is counted once and forecasts never leak the next update", () => {
  const board = Array.from({ length: 8 }, (_, wave) => quote(5, 20, wave >= 6 ? 0.8 : 0.4));
  const uniform = Array(9).fill(1 / 9);
  const top = Array(9).fill(0.1), bottom = Array(9).fill(0.1);
  top[7] = 0.2;
  bottom[7] = 0.05;
  bottom[0] = 0.25;
  const weights = { kind: "latent", components: [
    { prior: 0.5, hot: true, signedHigh: Array(8).fill(0.5), surveys: [uniform, top] },
    { prior: 0.5, hot: false, signedHigh: Array(8).fill(0.5), surveys: [uniform, bottom] },
  ] };
  for (let n = 1; n <= 8; n++) {
    const o = view(board, Array(n).fill(true), 0);
    const expected = n < 7 ? 0.5 : 0.8;
    const d = rallyDecision(o, weights);
    near(d.persistence, expected);
    assert.deepEqual([d.action, d.advantage], ["pass", null]);
    const changedQuote = { ...o, forecast: o.forecast.map(q => ({ ...q, highChance: 0.9 })) };
    near(rallyDecision(changedQuote, weights).persistence, expected);
  }
  assert.deepEqual(rallyDecision({ done: true }, weights), { action: null, advantage: null, persistence: null });
});

test("current-only ablation plans over its measured transitions without reading history", () => {
  const rows = Array.from({ length: 2 }, (_, wave) => Array.from({ length: 18 }, () => {
    const next = wave === 0 ? Array(18).fill(0) : [];
    if (wave === 0) { next[6] = 0.8; next[7] = 0.2; }
    return { hot: 0.25, next };
  }));
  const weights = { kind: "current", rows };
  const board = [quote(5, 12), quote(5, 30)];
  for (const flags of [[true], [false, true]]) {
    const o = view(board, flags);
    Object.defineProperty(o, "history", { get() { throw new Error("Ablation read past data"); } });
    const d = rallyDecision(o, weights);
    near(d.persistence, 0.25);
    near(d.advantage, flags.length === 1 ? 2 : 30);
    assert.equal(d.action, "accept");
  }
});
