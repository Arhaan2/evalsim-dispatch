import { FLEET_PAIRS, fleetPairIndex } from "./fleetweek.js";
import { bestFleetAction, fleetContinuationFromProjection, fleetPlannerContinuation } from "./fleetweek-planner.js";
import { isOvernight, sameFreight } from "./overnight-policy.js";

// The bulletin can lead or lag a demand change. Condition its leading depot on
// both neighboring centers, and the observed hub on the current center and
// last realized hub. The center, its run length and the true tape stay hidden.
const states = [];
for (let current = 0; current < 3; current++) {
  for (let previous = 0; previous < 3; previous++) {
    for (let age = 1; age <= (previous === current ? 4 : 1); age++) {
      states.push({current, previous, age});
    }
  }
}
const hazards = [0.16, 0.38, 0.44, 0.36];
const edges = states.map(({current, age}) => [0,1,2].map(next => ({
  next, to:states.findIndex(s => s.previous === current && s.current === next &&
    s.age === (next === current ? Math.min(4, age + 1) : 1)),
  probability:next === current ? 1 - hazards[age-1] : hazards[age-1]/2,
})));

function leader(row) { return row.indexOf(Math.max(...row)); }
function normalize(row) {
  const total = row.reduce((sum, n) => sum + n, 0);
  return row.map(n => n / total);
}
function leadProbability(called, previous, current, next) {
  return (called === current ? 0.56 : 0.08) + 0.14 * Number(called === previous) +
    0.14 * Number(called === next);
}

export function overrideBelief(obs) {
  const calls = obs.forecast.map(leader);
  const seen = obs.history.map(frame => frame.hub).concat(obs.hub);
  const factors = [], forward = [];
  let weights = states.map(s => s.age === 1 && s.current === s.previous ? 1 / 3 : 0);
  for (let t = 0; t < calls.length; t++) {
    forward.push(weights);
    const next = new Float64Array(states.length);
    const row = new Float64Array(states.length * 3);
    states.forEach((s, i) => {
      const observed = t >= seen.length ? 1 : 0.11 / 3 +
        (t === 0 ? 0.89 : 0.68) * Number(seen[t] === s.current) +
        (t > 0 ? 0.21 * Number(seen[t] === seen[t-1]) : 0);
      for (const edge of edges[i]) {
        const neighbor = t === calls.length - 1 ? s.current : edge.next;
        const factor = observed * leadProbability(calls[t], s.previous, s.current, neighbor) * edge.probability;
        row[i*3 + edge.next] = factor;
        next[edge.to] += weights[i] * factor;
      }
    });
    factors.push(row);
    weights = normalize(next);
  }
  const posterior = new Array(calls.length);
  let backward = new Float64Array(states.length).fill(1);
  for (let t = calls.length - 1; t >= 0; t--) {
    const before = new Float64Array(states.length);
    const mass = [0,0,0];
    for (let i = 0; i < states.length; i++) {
      for (const edge of edges[i]) before[i] += factors[t][i*3+edge.next] * backward[edge.to];
      mass[states[i].current] += forward[t][i] * before[i];
    }
    posterior[t] = normalize(mass);
    backward = normalize(before);
  }
  return posterior;
}

export function overrideContext(obs, base = fleetPlannerContinuation(obs), continuation = fleetContinuationFromProjection) {
  const belief = overrideBelief(obs);
  const adjusted = continuation(obs.epoch, obs.hub, belief);
  const calls = obs.forecast.map(leader), t = obs.epoch;
  const seen = obs.history.map(row => row.hub).concat(obs.hub);
  const prev = seen.at(-2), home = seen[0];
  const agreement = seen.filter((hub, i) => hub === calls[i]).length / seen.length;
  const next = Math.min(9,t+1), later = Math.min(9,t+2);
  const reliability = Math.max(...belief[next]);
  // Features of each ending placement. Differences encode exactly which depots
  // the proposed trip covers or leaves uncovered relative to the planner.
  const placements = FLEET_PAIRS.map(pair => {
    const out = [adjusted[fleetPairIndex(pair)] / 40, base[fleetPairIndex(pair)] / 40];
    for (const covered of [d => Number(pair.includes(d)), d => Number(pair[0] === d && pair[1] === d)]) {
      const f = new Float64Array(15);
      for (let d = 0; d < 3; d++) {
        const a = covered(d);
        if (!a) continue;
        const evidence = [1, belief[next][d], belief[later][d], belief[t][d],
          Number(calls[next] === d), Number(calls[later] === d),Number(calls[t] === d),
          Number(obs.hub === d), Number(prev === d), Number(home === d),
          obs.forecast[next][d], belief[next][d] * Number(obs.hub === d),
          belief[next][d] * Number(home === d), belief[next][d] * belief[later][d],
          seen.filter(h => h === d).length / seen.length];
        for (let j = 0; j < f.length; j++) f[j] += a * evidence[j];
      }
      out.push(...f);
    }
    // At the three fixed depots different driving costs can change the
    // value of covering a particular center, even at the same demand odds.
    for (const d of [0,1,2]) {
      out.push(Number(pair.includes(d)), Number(pair.includes(d))*belief[next][d],
        Number(pair[0] === d && pair[1] === d));
    }
    return out;
  });
  return {base, adjusted, placements, agreement, reliability, epoch:t};
}

// Actions leading to the same unordered depot pair have identical future
// opportunities. Use the best immediate ledger for that pair. A swap with
// identical placements cannot improve on the reference and is excluded.
export function distinctOverrides(menu, reference) {
  const same = fleetPairIndex(reference.positions), byPair = new Map();
  for (const action of menu) {
    if (!sameFreight(reference,action)) continue;
    const pair = fleetPairIndex(action.positions);
    if (pair === same) continue;
    const current = byPair.get(pair);
    if (!current || action.net > current.net) byPair.set(pair,action);
  }
  return [...byPair.values()];
}

export function overrideExample(context, reference, alternative) {
  const from = fleetPairIndex(reference.positions), to = fleetPairIndex(alternative.positions);
  const immediate = alternative.net - reference.net;
  const baseline = immediate + context.base[to] - context.base[from];
  const corrected = immediate + context.adjusted[to] - context.adjusted[from];
  const adjustment = (corrected-baseline)/20;
  const features = [1, baseline/30, immediate/30, adjustment,
    adjustment*context.agreement, adjustment*context.reliability,
    Math.min(0,corrected)/30, Math.max(0,corrected)/30,
    Number(immediate>0),Number(immediate<0),Number(immediate===0)];
  const left = context.placements[from], right = context.placements[to];
  for (let j=0; j<left.length; j++) features.push(right[j]-left[j]);
  // Share the head across nights; three interactions let a near-term signal
  // matter differently with fewer remaining chances to reposition.
  const nightsLeft = (7-context.epoch)/6;
  features.push(nightsLeft*adjustment, nightsLeft*(right[3]-left[3]),
    nightsLeft*(right[18]-left[18]));
  return {features,baseline,from,to,immediate};
}

function dot(coefficients, features) {
  let sum=0;
  for (let i=0;i<features.length;i++) sum+=coefficients[i]*features[i];
  return sum;
}

export function overrideEstimates(context, menu, reference, model) {
  return distinctOverrides(menu,reference).map(action => {
    const {baseline,features} = overrideExample(context,reference,action);
    return {id:action.id, baseline, residual:dot(model.net,features), service:dot(model.service,features)};
  });
}

export function selectOverride(plannerId, alternatives, settings) {
  let proposal=null, best=-Infinity, netGain=null;
  for (const alt of alternatives) {
    const net = alt.baseline + settings.blend*alt.residual;
    const score = net + settings.serviceCredit*alt.service;
    if (score > best) { best=score; proposal=alt; netGain=net; }
  }
  const accept = proposal !== null && !settings.plannerOnly && best > settings.threshold;
  return {plannerId, proposalId:proposal?.id ?? null, chosenId:accept ? proposal.id : plannerId,
    netGain, serviceGain:proposal?.service ?? null, score:proposal ? best : null, threshold:settings.threshold};
}

export function inspectOverride(obs, menu, checkpoint) {
  const base = fleetPlannerContinuation(obs), plannerId = bestFleetAction(menu,base);
  const ref = menu.find(a => a.id === plannerId);
  const alternatives = isOvernight(obs.epoch) && distinctOverrides(menu,ref).length ?
    overrideEstimates(overrideContext(obs,base),menu,ref,checkpoint) : [];
  return selectOverride(plannerId,alternatives,checkpoint.settings);
}

export function makeOverridePolicy(checkpoint) {
  return (obs,menu) => inspectOverride(obs,menu,checkpoint).chosenId;
}
