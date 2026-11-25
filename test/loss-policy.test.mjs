import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createFleetWeek,FLEET_PAIRS,fleetWeekActions} from "../docs/lib/fleetweek.js";
import {inspectOverride} from "../docs/lib/override-policy.js";
import {inspectUncertainty,uncertaintyFrame,candidateOnFrame} from "../docs/lib/uncertainty-policy.js";
import {inspectLoss,lossDecision,lossInputs,lossEstimate,rawLossEstimate} from "../docs/lib/loss-policy.js";
import {calibrateBins,lossSettings} from "../training/loss/fit.mjs";

const checkpoint=group=>JSON.parse(readFileSync(new URL("../docs/data/"+group+"/model-13.json",import.meta.url)));
const uncertainty=checkpoint("uncertainty"),prior=checkpoint("override");
const settings={blend:1,serviceCredit:0,hurdle:0,plannerOnly:false};
test("the matched prevalence control replaces only the probability of losing and can flip a veto",()=>{
  const c={planner:{id:"W|C"},proposal:{id:"E0|C"}};
  const example={lossProbability:0.8,rawProbability:0.75,lossSize:30,nonLossGain:45,serviceGain:0,legacyNet:10};
  const a=lossDecision(c,example,settings,0.4),b=lossDecision(c,example,settings,0.4,{flatLoss:true});
  assert.equal(a.chosenId,c.planner.id);assert.equal(b.chosenId,c.proposal.id);
  assert.equal(a.flatScore,b.score);assert.equal(b.usedProbability,0.4);
  for(const field of ["lossSize","nonLossGain","lossProbability","serviceGain","rawProbability"])assert.equal(a[field],b[field]);
  const tie=lossDecision(c,{...example,lossProbability:0.5,lossSize:45},settings,0.4);
  assert.equal(tie.score,0);assert.equal(tie.chosenId,c.planner.id);
});
test("stabilized monotone calibration pools descending neighboring rates and covers empty end bins",()=>{
  const counts=[0,100,100,0,0,0,0,0,0,0],losses=[0,40,20,0,0,0,0,0,0,0];
  const bins=calibrateBins(counts,losses);
  assert.equal(bins[1],bins[2]);assert.equal(bins[1],64/220);
  assert.deepEqual([...bins].sort((a,b)=>a-b),bins);assert.equal(bins[0],.05);assert.equal(bins[9],.95);
  const inputs={outlook:{loss:0.3},x:[1]};
  assert.equal(rawLossEstimate(inputs,{classLoss:[-.9]}),0);
  assert.equal(rawLossEstimate(inputs,{classLoss:[2]}),1);
  assert.equal(lossSettings().length,19);assert.equal(lossSettings()[0].plannerOnly,true);
});
test("legal public observations reproduce the eligible proposal and the exact labeled continuation",()=>{
  let seen=0,absent=0;
  for(let seed=0;seed<8;seed++){
    const world=createFleetWeek({family:"alternating",seed:60000+seed});
    while(!world.done){
      const obs=world.observe(),frame=uncertaintyFrame(obs);
      for(const positions of FLEET_PAIRS){
        const state={...obs,positions},menu=fleetWeekActions(state),c=candidateOnFrame(frame,menu,prior);
        const inputs=lossInputs(frame,c,uncertainty),base=inspectOverride(state,menu,prior);
        if(!inputs){
          assert.equal(base.plannerId,base.chosenId);
          const d=inspectLoss(state,menu,{settings,globalLossRate:.5},prior,uncertainty);
          assert.equal(d.chosenId,base.chosenId);assert.equal(d.lossProbability,null);absent++;continue;
        }
        seen++;assert.equal(c.proposal.id,base.chosenId);
        assert.equal(inputs.suffixId,inspectUncertainty(state,menu,uncertainty,prior,{flatRisk:true}).chosenId);
        assert(inputs.outlook.loss>=0 && inputs.outlook.loss<=1 && inputs.outlook.tie>=0);
        assert(inputs.outlook.loss+inputs.outlook.tie<=1+1e-12);
        assert(inputs.x.every(Number.isFinite));
        const zeroes=Array(inputs.x.length).fill(0),m={classLoss:zeroes,lossAmount:zeroes,
          nonLossAmount:zeroes,service:zeroes,calibratedBins:Array(10).fill(.5),settings,globalLossRate:.5};
        const e=lossEstimate(inputs,m),actual=inspectLoss(state,menu,m,prior,uncertainty);
        assert.equal(e.serviceGain,inputs.legacyService);assert.equal(actual.proposalId,c.proposal.id);
        assert.deepEqual(actual,lossDecision(c,e,settings,.5));
      }
      world.step("W|W");
    }
  }
  assert(seen>0 && absent>seen);
});
