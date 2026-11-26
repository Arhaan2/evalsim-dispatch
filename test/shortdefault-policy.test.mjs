import assert from "node:assert/strict";
import test from "node:test";
import {closureActions,closureFrames} from "../docs/lib/closure-world.js";
import {closureFrame} from "../docs/lib/closure-planner.js";
import {gateAdvantage,longRepairDecision,longRepairProposal} from "../docs/lib/longrepair-policy.js";
import {chooseShortDefault,shortDefaultDecision,shortDefaultProposal} from "../docs/lib/shortdefault-policy.js";
import {tapeTargets,weights} from "../training/shortdefault/fit.mjs";

test("a positive service estimate cannot authorize a credit-losing switch or a tie",()=>{
  const p={eligible:true,shortId:"S",longId:"L"},s={shortOnly:false,serviceCredit:12,hurdle:2};
  for (const v of [[-1,2],[2,2],[3,-1],[3,-1/12]]) assert.equal(chooseShortDefault(p,v,s).chosenId,"S");
  assert.equal(chooseShortDefault(p,[3,0],s).chosenId,"L");
  assert.equal(chooseShortDefault(p,[3,0],{...s,shortOnly:true}).chosenId,"S");
  assert.equal(chooseShortDefault({...p,eligible:false},[3,0],s).chosenId,"S");
});
test("the constant-score control uses the same strict switching rule",()=>{
  const p={eligible:true,shortId:"S",longId:"L"};
  const model={settings:{shortOnly:false,serviceCredit:30,hurdle:0},calibration:{net:{mean:-2},service:{mean:1}}};
  assert.equal(shortDefaultDecision(p,model,{flatGate:true}).chosenId,"S");
  assert.deepEqual(gateAdvantage(p,model,{flatGate:true}),[-2,1]);
});
test("both disagreement directions have correct signed features, offsets and Friday labels",()=>{
  const directions=new Set();
  const friday=(frames,t,first)=>{
    let net=first.net,served=first.served,pos=first.positions;
    for (let k=t+1;k<10;k++) {
      const f=frames[k],menu=closureActions({...f.obs,positions:pos});
      const p=longRepairProposal(f,menu,weights);
      const id=longRepairDecision(p,weights.short).chosenId,a=menu.find(x=>x.id===id);
      net+=a.net;served+=a.served;pos=a.positions;
    }
    return [net,served];
  };
  for (let seed=0;seed<512 && directions.size<2;seed++) {
    const frames=closureFrames({family:"steady-market",seed,closure:{starts:[2,4,6],durations:[1,2,3,4,5]}}).map(closureFrame);
    tapeTargets(frames,(p,y,t,pos)=>{
      const f=frames[t],menu=closureActions({...f.obs,positions:pos});
      const original=longRepairProposal(f,menu,weights),short=longRepairDecision(original,weights.short),
        long=longRepairDecision(original,weights.long);
      assert.equal(p.shortId,short.chosenId);assert.equal(p.longId,long.chosenId);
      assert.notEqual(p.shortId,p.longId);
      const direction=p.longId===original.closureId ? 1 : -1;
      directions.add(direction);
      assert.deepEqual(p.x.slice(1,-5),original.x.slice(1).map(v=>v*direction));
      assert.equal(p.x.at(-5),direction);assert.equal(p.x.length,49);
      assert.equal(p.priorNet,direction*(short.expectedNet+long.expectedNet)/2);
      assert.equal(p.priorService,direction*(short.expectedService+long.expectedService)/2);
      const a=friday(frames,t,menu.find(x=>x.id===short.chosenId));
      const b=friday(frames,t,menu.find(x=>x.id===long.chosenId));
      assert.deepEqual(y,[b[0]-a[0],b[1]-a[1]]);
    });
    const f=frames[9],menu=closureActions(f.obs),p=shortDefaultProposal(f,menu,weights);
    assert.equal(p.eligible,false);assert.equal(p.longId,p.shortId);assert.equal(p.x,null);
  }
  assert.deepEqual([...directions].sort(),[-1,1]);
});
