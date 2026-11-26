import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {createFleetWeek,FLEET_PAIRS,fleetWeekActions,fleetWeekBoardScenarios} from "../docs/lib/fleetweek.js";
import {chooseFleetPlanner,fleetWeekHubProjection} from "../docs/lib/fleetweek-planner.js";
import {makeUncertaintyPolicy} from "../docs/lib/uncertainty-policy.js";
import {createClosureWeek,closureActions,closureFrames,closureDurations,closureProbabilities} from "../docs/lib/closure-world.js";
import {chooseClosurePlanner,closureContinuation,makeClosureFlatRisk} from "../docs/lib/closure-planner.js";

const fixture={family:"steady-market",seed:43};
const model=name=>JSON.parse(fs.readFileSync(new URL("../docs/data/"+name+"/model-13.json",import.meta.url)));
const weights={override:model("override"),uncertainty:model("uncertainty")};
const near=(x,y,epsilon=1e-10)=>assert(Math.abs(x-y)<epsilon,x+" vs "+y);

test("all dispatchers see identical notices and freight, with actual duration hidden until it plays out",()=>{
  const short=closureFrames({...fixture,closure:{starts:[4],durations:[1]}});
  const long=closureFrames({...fixture,closure:{starts:[4],durations:[4]}});
  const plain=closureFrames({...fixture,closure:null});
  assert.deepEqual(short.slice(0,5),long.slice(0,5));
  assert.deepEqual(plain.slice(0,3),long.slice(0,3));
  assert.deepEqual(long.map(o=>o.incident.status),["clear","clear","clear","warning","closed","closed","closed","closed","reopened","reopened"]);
  assert.deepEqual(short.map(o=>o.incident.status),["clear","clear","clear","warning","closed","reopened","reopened","reopened","reopened","reopened"]);
  assert.equal(long[4].incident.update,null);
  assert(["on-track","delayed"].includes(long[5].incident.update));
  for (const [t,o] of long.entries()) {
    assert.deepEqual(o.orders,plain[t].orders);
    assert.deepEqual(o.forecast,plain[t].forecast);
    assert.deepEqual(Object.keys(o.incident).sort(),["depot","start","status","update"]);
  }
  const sim=createClosureWeek({...fixture,closure:{starts:[4],durations:[4]}});
  for (const frame of long) {
    const o=sim.observe();
    assert.deepEqual(o.incident,frame.incident);
    assert.deepEqual(o.orders,frame.orders);
    sim.step(sim.legalActions().at(-1).id);
  }
  assert.equal(sim.ledger.contracts,10);
  assert.throws(()=>sim.step("W|W"),/complete/);
  for (const profile of [{starts:[],durations:[1]},{starts:[-1],durations:[1]},{starts:[1],durations:[6]}])
    assert.throws(()=>createClosureWeek({...fixture,closure:profile}),/timing/);
});

test("a closed depot suspends touching loads and inbound empty moves but permits waiting and evacuation",()=>{
  const sim=createClosureWeek({...fixture,closure:{starts:[2],durations:[3]}});
  sim.step("W|W");sim.step("W|W");
  const obs=sim.observe(),{depot}=obs.incident;
  const before=sim.ledger;
  const illegal=fleetWeekActions(obs).find(a=>!sim.legalActions().includes(a));
  assert.throws(()=>sim.step(illegal.id),/Illegal closure action/);
  assert.deepEqual(sim.ledger,before);
  for (const positions of [[depot,depot],[0,1],[2,0]]) {
    const context={...obs,positions};
    const legal=closureActions(context);
    assert.deepEqual(legal,closureActions(structuredClone(context)));
    assert(legal.some(a=>a.id==="W|W"));
    if (positions[0]===depot) assert(legal.some(a=>a.moves[0]==="E"+((depot+1)%3)));
    for (const a of fleetWeekActions(context)) {
      const blocked=a.moves.some((move,truck)=>{
        if (move==="W") return false;
        if (move[0]==="E") return a.positions[truck]===depot;
        const o=obs.orders.find(o=>o.id===move);
        return o.origin===depot || o.destination===depot;
      });
      assert.equal(legal.includes(a),!blocked);
    }
  }
  const result=sim.step("W|W");
  assert.equal(result.ledger.penalty,before.penalty+34);
  assert.equal(result.ledger.contracts,3);
});

test("posterior excludes impossible repairs and uses only the issued field report",()=>{
  const [obs]=closureFrames(fixture);
  const frame=(epoch,status,update)=>({...obs,epoch,incident:{depot:1,start:4,status,update}});
  assert.deepEqual(closureDurations(frame(3,"warning",null)),[.2,.2,.2,.2,.2]);
  near(closureProbabilities(frame(4,"closed",null))[5],.8);
  for (const update of ["delayed","on-track"]) {
    const publicInfo=frame(5,"closed",update);
    const weights=closureDurations(publicInfo);
    assert.equal(weights[0],0);
    near(weights.reduce((a,b)=>a+b),1);
    near(closureProbabilities(publicInfo)[5],1);
  }
  assert(closureProbabilities(frame(5,"closed","delayed"))[7]>closureProbabilities(frame(5,"closed","on-track"))[7]);
  assert.deepEqual(closureProbabilities(frame(5,"reopened",null)),Array(10).fill(0));
});

test("planner and constant-penalty adapter match their published policies before any notice and on ordinary weeks",()=>{
  const flat=makeClosureFlatRisk(weights), old=makeUncertaintyPolicy(weights.uncertainty,weights.override,{flatRisk:true});
  for (const family of ["steady-market","midweek-return"]) for (let seed=1;seed<=20;seed++) {
    const sim=createFleetWeek({family,seed});
    const clean=createClosureWeek({family,seed,closure:null});
    while (!sim.done) {
      const o=sim.observe(),a=clean.observe(), menu=sim.legalActions();
      assert.deepEqual(menu,clean.legalActions());
      assert.equal(chooseClosurePlanner(a,menu),chooseFleetPlanner(o,menu));
      const first=flat(a,menu), second=old(o,menu);
      assert.equal(first,second);
      sim.step(first);clean.step(second);
    }
    assert.deepEqual(clean.ledger,sim.ledger);
  }
});

test("two-board repair planner agrees with explicit status and board enumeration",()=>{
  // Thursday PM: already closed, current report known. The next morning can
  // reveal reopening or continued closure before the dispatcher chooses.
  const o=closureFrames(fixture)[7];
  const obs={...o,incident:{depot:1,start:6,status:"closed",update:"on-track"}};
  const posterior=fleetWeekHubProjection(obs);
  // Condition on surviving length 1 and on receiving 'on-track'.
  const masses=[0,.75,.50,.25,.10],total=masses.reduce((a,b)=>a+b);
  const pOpen8=masses[1]/total, pOpen9GivenClosed8=masses[2]/(total-masses[1]);
  const states=[{closed:false,prob:pOpen8},{closed:true,prob:1-pOpen8}];
  const chance=(t,hub,prev)=>.68*posterior[t][hub]+.21*Number(hub===prev)+.11/3;
  const menu=(b,positions,closed)=>closureActions({positions,orders:b.orders,incident:{status:closed?"closed":"reopened",depot:1}});
  const last=new Map();
  function fridayPMValue(positions,prior,closed) {
    const k=[...positions,prior,closed].join();
    if (!last.has(k)) {
      let value=0;
      for (const b of fleetWeekBoardScenarios(9)) {
        const best=Math.max(...menu(b,positions,closed).map(a=>a.net));
        value+=chance(9,b.hub,prior)*b.weight*best;
      }
      last.set(k,value);
    }
    return last.get(k);
  }
  const curve=closureContinuation(obs,posterior);
  for (const [i,positions] of FLEET_PAIRS.entries()) {
    let direct=0;
    for (const {closed,prob} of states) for (const b of fleetWeekBoardScenarios(8)) {
      const pOpen=!closed ? 1 : pOpen9GivenClosed8;
      const best=Math.max(...menu(b,positions,closed).map(a=>a.net + pOpen*fridayPMValue(a.positions,b.hub,false)
        +(1-pOpen)*fridayPMValue(a.positions,b.hub,true)));
      direct+=prob*chance(8,b.hub,o.hub)*b.weight*best;
    }
    near(curve[i],direct);
  }
});
