// The latent market is fixed for an entire shift. A component describes the
// observed price and survey distributions learned for one training market.
const cache = new WeakMap();
export const SURVEY_WAVES = Object.freeze([3, 6]);
const BINS = 9;
const STATES = BINS * 2;
export const surveyBin = probability => Math.round(10 * probability) - 1;
export const publicState = (quote, high) => 2 * surveyBin(quote.highChance) + Number(high);

function evidenceIndex(wave, bits, first, last) {
  return bits + (first + last * BINS) * 2 ** (wave + 1);
}

function emissions(components, horizon) {
  return Array.from({ length: horizon }, (_, wave) => {
    const survey = SURVEY_WAVES.indexOf(wave);
    const outcomes = [];
    for (let bin = 0; bin < (survey < 0 ? 1 : BINS); bin++) {
      for (let high = 0; high <= 1; high++) {
        const likelihood = components.map(component => {
          const highChance = component.signedHigh[wave];
          const surveyChance = survey < 0 ? 1 : component.surveys[survey][bin];
          return surveyChance * (high ? highChance : 1 - highChance);
        });
        outcomes.push({ bin, high, likelihood });
      }
    }
    return outcomes;
  });
}

// For each possible public history, integrate over the next signed offer and
// any newly released survey. Children return probability-weighted optimal
// earnings so both capacity continuations use the same posterior branches.
function solveLatent(support, components) {
  const horizon = support.length;
  const layers = support.map((_, t) => {
    const entries = 2 ** (t + 1) * (t >= 3 ? BINS : 1) * (t >= 6 ? BINS : 1);
    return { p: new Float64Array(entries), one: new Float64Array(entries), two: new Float64Array(entries) };
  });
  const outcomes = emissions(components, horizon);
  const hot = components.map(c => Number(c.hot));
  function visit(wave, bits, first, last, masses) {
    let one = 0, two = 0;
    const next = new Float64Array(masses.length);
    for (const { bin, high, likelihood } of outcomes[wave]) {
      let mass = 0, hotMass = 0;
      for (let j = 0; j < masses.length; j++) {
        next[j] = masses[j] * likelihood[j];
        mass += next[j];
        hotMass += next[j] * hot[j];
      }
      if (!mass) continue;
      const nextBits = bits + high * 2 ** wave;
      const q1 = wave === 3 ? bin : first;
      const q2 = wave === 6 ? bin : last;
      const id = evidenceIndex(wave, nextBits, q1, q2);
      const rest = wave + 1 === horizon ? [0, 0] : visit(wave + 1, nextBits, q1, q2, next);
      const reward = (high ? support[wave].high : support[wave].low) * mass;
      const bookOne = reward, bookTwo = reward + rest[0];
      const layer = layers[wave];
      layer.p[id] = hotMass / mass;
      layer.one[id] = (bookOne - rest[0]) / mass;
      layer.two[id] = (bookTwo - rest[1]) / mass;
      one += Math.max(bookOne, rest[0]);
      two += Math.max(bookTwo, rest[1]);
    }
    return [one, two];
  }
  visit(0, 0, 0, 0, components.map(c => c.prior));
  return layers;
}

// The control fits transitions between the current bulletin/price states.
// After every transition its next booking can react to the new state.
function solveCurrent(support, rows, from) {
  let futureOne = new Float64Array(STATES), futureTwo = new Float64Array(STATES);
  let layer;
  for (let wave = support.length - 1; wave >= from; wave--) {
    const one = new Float64Array(STATES), two = new Float64Array(STATES);
    layer = { one: new Float64Array(STATES), two: new Float64Array(STATES), p: [] };
    for (let state = 0; state < STATES; state++) {
      const model = rows[wave][state];
      let passOne = 0, passTwo = 0;
      for (let n = 0; n < model.next.length; n++) {
        passOne += model.next[n] * futureOne[n];
        passTwo += model.next[n] * futureTwo[n];
      }
      const value = state % 2 ? support[wave].high : support[wave].low;
      layer.p[state] = model.hot;
      layer.one[state] = value - passOne;
      layer.two[state] = value + passOne - passTwo;
      one[state] = Math.max(value, passOne);
      two[state] = Math.max(value + passOne, passTwo);
    }
    futureOne = one;
    futureTwo = two;
  }
  return layer;
}

function boardKey(quotes) {
  return quotes.map(quote => quote.low + "/" + quote.high).join(",");
}

function cached(weights, key, compute) {
  let boards = cache.get(weights);
  if (!boards) {
    boards = new Map();
    cache.set(weights, boards);
  }
  if (!boards.has(key)) boards.set(key, compute());
  return boards.get(key);
}

export function rallyDecision(o, weights) {
  if (o.done) return { action: null, persistence: null, advantage: null };
  const high = o.offer.net === o.quote.high;
  const remaining = [o.quote, ...o.forecast];
  let layer, index;
  if (weights.kind === "latent") {
    const board = [...o.history.map(row => row.quote), ...remaining];
    const layers = cached(weights, boardKey(board), () => solveLatent(board, weights.components));
    let bits = Number(high) * 2 ** o.wave;
    for (const row of o.history) bits += Number(row.high) * 2 ** row.wave;
    const first = o.wave >= 3 ? surveyBin(board[3].highChance) : 0;
    const last = o.wave >= 6 ? surveyBin(board[6].highChance) : 0;
    index = evidenceIndex(o.wave, bits, first, last);
    layer = layers[o.wave];
  } else if (weights.kind === "current") {
    // The ablated policy never reads o.history, even to reconstruct the board.
    const board = [...Array(o.wave), ...remaining];
    layer = cached(weights, o.wave + ":" + boardKey(remaining), () => solveCurrent(board, weights.rows, o.wave));
    index = publicState(o.quote, high);
  } else {
    throw new Error("Unknown rally checkpoint.");
  }
  const persistence = layer.p[index];
  if (!o.slots) return { action: "pass", persistence, advantage: null };
  const advantage = (o.slots === 1 ? layer.one : layer.two)[index];
  return { action: advantage >= 0 ? "accept" : "pass", persistence, advantage };
}

export const chooseRally = (o, weights) => rallyDecision(o, weights).action;
