// One repair incident is sampled independently of the immutable public freight tape.
import {createFleetWeek, fleetWeekActions} from "./fleetweek.js";

const clear = Object.freeze({status:"clear", depot:null, start:null, update:null});
const incidentMenu = new WeakMap();
const delayed = Object.freeze([0.1, 0.25, 0.5, 0.75, 0.9]);
export const CLOSURE_DELAY_LIKELIHOODS = delayed;

function incidentDraws(seed) {
  let state = (seed ^ 0x9876bdf1) >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  };
}
function repairNotices(seed, profile) {
  if (profile == null) return Array(10).fill(clear);
  function validate(list, max) {
    if (!Array.isArray(list) || !list.length || !list.every(n=>Number.isInteger(n) && n>=1 && n<=max)) {
      throw new RangeError("Invalid closure timing profile.");
    }
  }
  validate(profile.starts, 8);
  validate(profile.durations, 5);
  const draw = incidentDraws(seed);
  const pick = xs=>xs[Math.floor(draw()*xs.length)];
  const depot = Math.floor(draw()*3), start=pick(profile.starts), duration=pick(profile.durations);
  const update = draw() < delayed[duration-1] ? "delayed" : "on-track";
  return Array.from({length:10}, (_,t)=>{
    if (t<start-1) return clear;
    const status=t===start-1 ? "warning" : t<start+duration ? "closed" : "reopened";
    return Object.freeze({status,depot,start,update:t>start && duration>=2 ? update : null});
  });
}

// The unconditional public repair bulletin puts equal mass on one to five closed
// half-days. Operating schedules may shift that distribution on held-out weeks.
export function closureDurations(obs) {
  const {status,start,update}=obs.incident;
  if (status!=="warning" && status!=="closed") return [];
  const weights=delayed.map((chance,index)=>{
    const duration=index+1;
    if (start+duration<=obs.epoch) return 0;
    return update==="delayed" ? chance : update==="on-track" ? 1-chance : 1;
  });
  const total=weights.reduce((a,b)=>a+b,0);
  return weights.map(w=>w/total);
}
export function closureProbabilities(obs) {
  const probabilities=Array(10).fill(0), weights=closureDurations(obs);
  for (let t=obs.epoch;t<10;t++) {
    for (let i=0;i<weights.length;i++) {
      if (t>=obs.incident.start && t<=obs.incident.start+i) probabilities[t]+=weights[i];
    }
  }
  return probabilities;
}

// Keep demand observable even when a depot cannot handle freight. Missing a
// contract, including one made impossible by the closure, incurs the same cost.
export function closureActions(obs) {
  if (!obs) return Object.freeze([]);
  const menu=fleetWeekActions(obs);
  if (obs.incident?.status!=="closed") return menu;
  const {depot}=obs.incident;
  let byDepot=incidentMenu.get(menu);
  if (!byDepot) { byDepot=[]; incidentMenu.set(menu,byDepot); }
  if (!byDepot[depot]) {
    const suspended=new Set(obs.orders.filter(o=>o.origin===depot || o.destination===depot).map(o=>o.id));
    byDepot[depot]=Object.freeze(menu.filter(a=>a.moves.every(move=>move!=="E"+depot && !suspended.has(move))));
  }
  return byDepot[depot];
}

export function createClosureWeek(config) {
  const world=createFleetWeek(config);
  const notices=repairNotices(config.seed,config.closure);
  let obs=null;
  function observe() {
    if (world.done) return null;
    const base=world.observe();
    obs??=Object.freeze({...base,incident:notices[base.epoch]});
    return obs;
  }
  const legalActions=()=>closureActions(observe());
  function step(id) {
    if (world.done) throw new RangeError("Closure week is complete.");
    if (!legalActions().some(a=>a.id===id)) throw new RangeError("Illegal closure action: "+String(id));
    const result=world.step(id);
    obs=null;
    return result;
  }
  return Object.freeze({observe,legalActions,step,get done(){return world.done;},get ledger(){return world.ledger;}});
}

// Public exogenous observations for paired replay. Each policy substitutes its
// own ordered truck positions before asking for a legal menu.
export function closureFrames(config) {
  const world=createClosureWeek(config), result=[];
  while (!world.done) { result.push(world.observe()); world.step("W|W"); }
  return result;
}
