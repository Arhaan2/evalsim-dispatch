import { createBooking, observeBooking, stepBooking, BOOKING_PATTERNS, BOOKING_SUITE } from "../../docs/lib/booking.js";
import { bookingContext, bookingKeys, earlyValues } from "../../docs/lib/booking-policy.js";
import { chooseSurvey } from "../../docs/lib/survey-policy.js";
import { surveyReferences } from "../../docs/lib/survey-benchmark.js";
import { prng } from "../protocol.mjs";

export const FIT_SPEC = Object.freeze({
  blockSize: 12000, fitSeeds: 2000, selectionSeeds: 1000, smoothing: 48,
  hotMasses: [1, 2, 4, 8, 16], recoveryMasses: [1, 4, 12], coldMass: 4, otherMass: 1,
});
const groupNames = ["hotDrops", "coldReversals", "recovery", "other"];
const baselineNames = ["stochastic", "rl", "rally", "trust", "drift", "turns"];

function drawSeeds(seed, start) {
  const rng = prng(seed);
  const bank = Array.from({ length: FIT_SPEC.blockSize }, (_, i) => start + i);
  const end = FIT_SPEC.fitSeeds + FIT_SPEC.selectionSeeds;
  for (let i = 0; i < end; i++) {
    const j = i + Math.floor(rng() * (bank.length - i));
    [bank[i], bank[j]] = [bank[j], bank[i]];
  }
  return [bank.slice(0, FIT_SPEC.fitSeeds), bank.slice(FIT_SPEC.fitSeeds, end)];
}

function divideMarkets(families) {
  const grouped = new Map(), fit = [], selection = [];
  let recoveries = 0;
  for (const family of families) {
    const p = BOOKING_PATTERNS[family];
    const paired = families.includes(p.stem + "-hot") && families.includes(p.stem + "-cold");
    if (!paired) {
      if (p.stratum !== "interrupted-drop" || p.ending !== "cold") throw new Error("Unknown recovery proxy.");
      (++recoveries % 3 === 0 ? selection : fit).push({ family, group: 2 });
      continue;
    }
    if (!grouped.has(p.stratum)) grouped.set(p.stratum, []);
    const stems = grouped.get(p.stratum);
    if (!stems.includes(p.stem)) stems.push(p.stem);
    let group = 3;
    if (p.stratum === "interrupted-drop" && p.ending === "hot") group = 0;
    if (p.stratum === "reversal" && p.ending === "cold") group = 1;
    ((stems.indexOf(p.stem) + 1) % 4 === 0 ? selection : fit).push({ family, group });
  }
  return { fit, selection };
}

// Index public histories once. All candidates reuse observations, offers, and
// the frozen late policy; their early decisions and returns are fitted anew.
function makeLayer(n) {
  return { groupById: new Map(), contexts: [], leaves: [], ids: new Uint16Array(n),
    prices: new Int16Array(n), nodeByKey: new Map(), nodes: [] };
}

function recordContext(layer, observation, index) {
  const e = bookingContext(observation);
  const idKey = e.low + "/" + e.high + "/" + e.odds + "/" + e.signs;
  let id = layer.groupById.get(idKey);
  if (id === undefined) {
    id = layer.contexts.length;
    layer.groupById.set(idKey, id);
    layer.contexts.push(e);
    let parent = -1;
    for (const key of bookingKeys(e)) {
      let node = layer.nodeByKey.get(key);
      if (node === undefined) {
        node = layer.nodes.length;
        layer.nodeByKey.set(key, node);
        layer.nodes.push({ key, parent });
      }
      parent = node;
    }
    layer.leaves.push(parent);
  }
  layer.ids[index] = id;
  layer.prices[index] = observation.offer.net;
}

function collect(seeds, markets, weights, compare) {
  const n = seeds.length * markets.length, groups = new Uint8Array(n);
  const layers = Array.from({ length: 6 }, () => makeLayer(n));
  const tailOne = new Int16Array(n), tailTwo = new Int16Array(n), groupCounts = Array(4).fill(0);
  const referenceTotals = groupNames.map(() => Object.fromEntries(baselineNames.map(k => [k,0])));
  const refs = surveyReferences(weights);
  let index = 0;
  for (const { family, group } of markets) {
    for (const seed of seeds) {
      const state = createBooking({ family, seed });
      let o = observeBooking(state);
      const slots = Array(baselineNames.length).fill(2);
      const net = Array(baselineNames.length).fill(0);
      const late = [];
      while (!o.done) {
        if (o.wave < 6) recordContext(layers[o.wave], o, index);
        else late.push({ price: o.offer.net, one: chooseSurvey({ ...o, slots: 1 }, weights.survey),
          two: chooseSurvey({ ...o, slots: 2 }, weights.survey) });
        if (compare) {
          for (let j = 0; j < baselineNames.length; j++) {
            if (!slots[j]) continue;
            if (refs[baselineNames[j]]({ ...o, slots: slots[j], net: net[j] }) === "accept") {
              net[j] += o.offer.net;
              slots[j]--;
            }
          }
        }
        o = stepBooking(state, "pass");
      }
      // A booking at seven with two slots leaves one for the final wave.
      const [penultimate, final] = late;
      const oneAtFinal = final.one === "accept" ? final.price : 0;
      tailOne[index] = penultimate.one === "accept" ? penultimate.price : oneAtFinal;
      tailTwo[index] = penultimate.two === "accept" ? penultimate.price + oneAtFinal :
        (final.two === "accept" ? final.price : 0);
      groups[index] = group;
      groupCounts[group]++;
      if (compare) for (let j = 0; j < net.length; j++) referenceTotals[group][baselineNames[j]] += net[j];
      index++;
    }
  }
  return { n, groups, groupCounts, referenceTotals, layers, tailOne, tailTwo };
}

function profiles() {
  const values = [{ id: "equal", masses: null }];
  for (const hot of FIT_SPEC.hotMasses) for (const recovery of FIT_SPEC.recoveryMasses) {
    values.push({ id: "hot-" + hot + "-recovery-" + recovery,
      masses: [hot, FIT_SPEC.coldMass, recovery, FIT_SPEC.otherMass] });
  }
  return values;
}

export function fitEarlyCandidate(data, profile) {
  const { n, groups, groupCounts } = data;
  const priorities = groupCounts.map((count, j) => profile.masses ?
    n * profile.masses[j] / (count * profile.masses.reduce((total, mass) => total + mass, 0)) : 1);
  const tables = Array(6);
  let one = data.tailOne, two = data.tailTwo;
  for (let wave = 5; wave >= 0; wave--) {
    const { ids, prices, leaves, nodes } = data.layers[wave];
    const sums = new Float64Array(nodes.length * 3);
    for (let i = 0; i < n; i++) {
      const k = 3 * leaves[ids[i]], w = priorities[groups[i]];
      sums[k] += w;
      sums[k+1] += w * one[i];
      sums[k+2] += w * two[i];
    }
    // A single credit ledger supplies paired book/wait returns. Aggregate
    // leaf observations up the hierarchy before estimating parent and child.
    for (let k = nodes.length-1; k > 0; k--) {
      const parent = 3 * nodes[k].parent;
      for (let j = 0; j < 3; j++) sums[parent+j] += sums[3*k+j];
    }
    const table = {}, estimates = [];
    for (const [i,node] of nodes.entries()) {
      const k = 3*i, prior = node.parent < 0 ? 0 : FIT_SPEC.smoothing;
      const parent = estimates[node.parent];
      const row = Array.from({ length: 2 }, (_, j) =>
        (sums[k+1+j] + (parent ? prior * parent[j] : 0)) / (sums[k]+prior));
      table[node.key] = row;
      estimates.push(row);
    }
    tables[wave] = table;
    const newOne = new Int16Array(n), newTwo = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const row = estimates[leaves[ids[i]]], reward = prices[i];
      newOne[i] = reward >= row[0] ? reward : one[i];
      newTwo[i] = reward + row[0] >= row[1] ? reward + one[i] : two[i];
    }
    one = newOne; two = newTwo;
  }
  return { profile: profile.id, tables };
}

// Each candidate sees the same held-in shift from start to finish. Compare
// group means in credits to the strictest frozen benchmark within each goal.
function selectScore(model, data) {
  const scores = Array(4).fill(0);
  const actions = data.layers.map((layer,wave) => layer.contexts.map(e => {
    const v = earlyValues(model.tables[wave],e);
    const price = ((e.signs >> wave) & 1) ? e.high : e.low;
    return [false, price >= v[0], price + v[0] >= v[1]];
  }));
  for (let i = 0; i < data.n; i++) {
    let slots = 2, earned = 0;
    for (let wave = 0; wave < 6 && slots; wave++) {
      const layer = data.layers[wave];
      if (actions[wave][layer.ids[i]][slots]) {
        slots--;
        earned += layer.prices[i];
      }
    }
    if (slots) earned += slots === 2 ? data.tailTwo[i] : data.tailOne[i];
    scores[data.groups[i]] += earned;
  }
  const deltas = scores.map((sum,group) => Object.fromEntries(baselineNames.map(k =>
    [k, (sum-data.referenceTotals[group][k])/data.groupCounts[group]])));
  const [hot,cold,recovery] = deltas;
  const slacks = [hot.stochastic, Math.min(cold.stochastic,cold.rl+1),
    Math.min(recovery.stochastic,recovery.rl, ...["rally","trust","drift","turns"].map(k => recovery[k]+1))];
  const means = Object.fromEntries(scores.map((sum,i) => [groupNames[i],sum/data.groupCounts[i]]));
  return { profile:model.profile, means, slacks, minimum:Math.min(...slacks), average:slacks.reduce((a,b)=>a+b,0)/3 };
}

export function fitBooking(index, seed, weights) {
  const train = BOOKING_SUITE.splits.train;
  if (!Number.isInteger(index) || index < 0 || (index+1)*FIT_SPEC.blockSize > train.count) throw new RangeError("Unknown booking fit block.");
  const start = train.start + index*FIT_SPEC.blockSize;
  const [fitSeeds,selectSeeds] = drawSeeds(seed,start);
  const { fit, selection: held } = divideMarkets(train.families);
  const data = collect(fitSeeds,fit,weights,false), validation = collect(selectSeeds,held,weights,true);
  const candidates = [];
  let selected, winner, equalWeights;
  for (const p of profiles()) {
    const candidate = fitEarlyCandidate(data,p);
    if (!p.masses) equalWeights = candidate;
    const score = selectScore(candidate,validation);
    candidates.push({ ...score, masses:p.masses });
    if (!winner || score.minimum > winner.minimum ||
        (score.minimum === winner.minimum && score.average > winner.average)) {
      winner = score;
      selected = candidate;
    }
  }
  const trainingCounts = { trainingSeed:seed, blockStart:start, blockSize:FIT_SPEC.blockSize, fitSeeds:fitSeeds.length,
    selectionSeeds:selectSeeds.length, fitFamilies:fit.map(p=>p.family), selectionFamilies:held.map(p=>p.family),
    fitShifts:data.n, selectionShifts:validation.n, earlyDecisions:data.n*6, pairedCapacityTargets:data.n*6*2 };
  return { weights:selected, equalWeights, trainingCounts,
    selection:{ profile:winner.profile, candidates,
      comparisonMeans:Object.fromEntries(validation.referenceTotals.map((sums,i) => [groupNames[i],
        Object.fromEntries(baselineNames.map(k=>[k,sums[k]/validation.groupCounts[i]]))])),
      groupNames, slackNames:["hotDrops","coldReversals","recovery"] } };
}
