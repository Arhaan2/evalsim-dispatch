import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createFleetWeek,FLEET_PAIRS,fleetWeekActions} from "../docs/lib/fleetweek.js";
import {inspectOverride} from "../docs/lib/override-policy.js";
import {candidateOnFrame,downsideFeatures,estimateCandidate,inspectUncertainty,uncertaintyDecision,uncertaintyFrame} from "../docs/lib/uncertainty-policy.js";

const predecessor=JSON.parse(readFileSync(new URL("../docs/data/override/model-13.json",import.meta.url)));
const settings={blend:1,serviceCredit:0,lambda:0.2,plannerOnly:false};
test("a larger conditional adverse surprise can veto an otherwise identical expected gain",()=>{
  const c={planner:{id:"W|C"},proposal:{id:"E0|C"},priorNetGain:3,priorServiceGain:0,x:[1],riskX:[1,1]};
  const m={net:[0],service:[0],downside:[5,15,0,0,0,0],settings,flatDownside:10};
  const a=estimateCandidate(c,m), b=estimateCandidate({...c,riskX:[1,0]},m);
  assert.equal(a.riskMean,b.riskMean);
  assert.equal(a.downside,20);assert.equal(b.downside,5);
  const choose=(e,options)=>uncertaintyDecision(c,e,settings,m.flatDownside,options);
  assert.equal(choose(a).riskVeto,true);assert.equal(choose(b).chosenId,"E0|C");
  for(const e of [a,b]) {
    assert.equal(choose(e,{flatRisk:true}).penalty,2);
    assert.equal(choose(e,{meanOnly:true}).chosenId,"E0|C");
  }
  const inactive={...settings,plannerOnly:true};
  assert.equal(uncertaintyDecision(c,b,inactive,10,{meanOnly:true}).chosenId,"W|C");
  assert.equal(uncertaintyDecision(c,b,inactive,10).riskVeto,false);
  assert.equal(choose({...b,riskMean:1,downside:5}).chosenId,"W|C");
});
test("uncertainty may only veto moves the actual released predecessor wanted to take",()=>{
  let reviews=0,unchanged=0;
  for(let seed=0;seed<12;seed++) {
    const world=createFleetWeek({family:"split-return",seed:920000+seed});
    while(!world.done) {
      const obs=world.observe(),frame=uncertaintyFrame(obs);
      for(const positions of FLEET_PAIRS) {
        const observation={...obs,positions},menu=fleetWeekActions(observation);
        const base=inspectOverride(observation,menu,predecessor);
        const cand=candidateOnFrame(frame,menu,predecessor);
        assert.equal(cand.planner.id,base.plannerId);
        const eligible=base.chosenId!==base.plannerId;
        assert.equal(cand.proposal?.id??null,eligible?base.chosenId:null);
        if(!eligible){unchanged++;continue;}
        reviews++;
        const mean={riskMean:0,fittedService:0};
        const model={net:Array(cand.x.length).fill(0),service:Array(cand.x.length).fill(0),
          downside:Array(downsideFeatures(cand,mean).length).fill(0),flatDownside:1,settings};
        const actual=inspectUncertainty(observation,menu,model,predecessor);
        assert.equal(actual.chosenId,base.chosenId);
        assert.equal(actual.netGain,base.netGain);
        assert.equal(actual.serviceGain,base.serviceGain);
        assert.equal(actual.downside,0);
      }
      world.step("W|W");
    }
  }
  assert(reviews>0 && unchanged>reviews);
});
