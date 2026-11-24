import test from "node:test";
import assert from "node:assert/strict";
import { chooseLastslot, lastslotDecision, boardKey, gateKey, packWait, waitValues, sixKey, sevenKey } from "../docs/lib/lastslot-policy.js";
import { suffixLaw, fitContinuation, calibratePaired } from "../training/lastslot/fit.mjs";

const close=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,actual+" vs "+expected);
const prices=[[7,24],[4,34],[4,32]];
const cold=[0.45,0.1,0.1,0.1],hot=[0.45,0.9,0.9,0.9];

test("fitted one-slot stopping values integrate each survey count, freight, and bulletin",()=>{
  // Identical late bulletins but distinct persistent demand. Check all branch
  // reward masses and both deployed policies against an independent tree walk.
  const laws=[suffixLaw(cold),suffixLaw(hot)];
  const mixed=laws[0].map((x,i)=>(x+laws[1][i])/2);
  const row=calibratePaired(mixed,prices,fitContinuation(mixed,prices));
  const waits=waitValues(row);
  let grossBuy=0,grossSkip=0;
  for(const rates of [cold,hot]) {
    const [p5,p6,p7,p8]=rates;
    for(let mask=0;mask<64;mask++) {
      const draw=mask.toString(2).replaceAll("0","").length;
      const surveyMass=p6**draw*(1-p6)**(6-draw);
      for(const noise of [-0.1,0,0.1]) for(let x=0;x<8;x++) {
        const bits=[x&1,(x>>1)&1,(x>>2)&1];
        const probability=surveyMass/6*bits.reduce((m,h,i)=>m*(h?rates[1+i]:1-rates[1+i]),1);
        const [six,seven,last]=bits.map((b,i)=>prices[i][b]);
        const bulletin=Math.round(10*(p5+noise));
        const play=r=>{
          const ix=sixKey(r,bits[0]);
          if(six>=waits[ix]) return six;
          return seven>=waits[16+sevenKey(ix,bulletin,bits[1])]?seven:last;
        };
        grossBuy+=probability*play(draw);
        grossSkip+=probability*play(-1);
      }
    }
  }
  close(row.skip,grossSkip,1e-6);
  close(row.delta,grossBuy-grossSkip,1e-6);
  assert.ok(row.delta>0.1);
  const noSignal=suffixLaw(cold);
  close(calibratePaired(noSignal,prices,fitContinuation(noSignal,prices)).delta,0);
});

test("only one slot is eligible; purchase crosses its calibrated marginal return and respects a forced control",()=>{
  const quote={low:9,high:18,highChance:0.4};
  const history=Array.from({length:5},(_,wave)=>({quote,wave,high:wave===1}));
  const o={phase:"survey",slots:1,wave:5,history,quote,surveyFee:0.25,offer:null};
  const row={skip:17,delta:0.27,wait:packWait(new Array(304).fill(18.123))};
  const model={boards:{[boardKey(quote)]:{[gateKey(4,2)]:row}}};
  close(lastslotDecision(o,model).advantage,0.02);
  assert.equal(chooseLastslot(o,model),"buy");
  assert.equal(chooseLastslot({...o,surveyFee:0.27},model),"skip");
  assert.equal(chooseLastslot(o,model,null,"never"),"skip");
  assert.equal(chooseLastslot({...o,surveyFee:1},model,null,"always"),"buy");
  for(const slots of [0,2]) for(const mode of ["always","never","optional"])
    assert.equal(chooseLastslot({...o,slots},model,null,mode),"skip");
  const f={...o,phase:"freight",reading:2,offer:{net:18}};
  assert.equal(chooseLastslot(f,model),"pass");
  close(lastslotDecision(f,model).waitValue,18.123);
  assert.equal(chooseLastslot({...f,wave:6,history:[...history,{quote,high:true}],offer:{net:20}},model),"accept");
});
