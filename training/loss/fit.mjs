import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {createFleetWeek, FLEET_FAMILIES, fleetWeekActions} from "../../docs/lib/fleetweek.js";
import {OVERRIDE_TRAIN_FAMILIES} from "../../docs/lib/override-markets.js";
import {candidateOnFrame, uncertaintyFrame} from "../../docs/lib/uncertainty-policy.js";
import {lossDecision, lossEstimate, lossInputs, rawLossEstimate} from "../../docs/lib/loss-policy.js";
import {solveFleetRidge} from "../fleetweek/fit.mjs";

const data = new URL("../../docs/data/", import.meta.url);
function frozenCheckpoint(name, hash) {
  const bytes = readFileSync(new URL(name+"/model-13.json", data));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, "Historical checkpoint changed");
  return JSON.parse(bytes);
}
const overrideHash = "f70b76a430aadf6c0050a2041208d8fc549c0767b98291574971b681e16a05f9";
const uncertaintyHash = "dec9377b49db274f14f0509e5f07d55e3aa2c1ed69a106dccf330fcc82e3fd3c";
const override = frozenCheckpoint("override", overrideHash);
const uncertainty = frozenCheckpoint("uncertainty", uncertaintyHash);
export const LOSS_FIT = Object.freeze({seeds:[13,37,73,101,211],
  families:[...FLEET_FAMILIES.train,...OVERRIDE_TRAIN_FAMILIES],start:400000000,stride:1000000,
  calibrationOffset:200000,selectionOffset:400000,fitCount:1024,calibrationCount:512,
  selectionCount:768,ridge:0.01,binPrior:10,blends:[0.5,1],serviceCredits:[0,15,35],hurdles:[0,2,4]});
const ordered = Array.from({length:9}, (_, i) => [Math.floor(i/3), i%3]);
const indexOf = pos => 3*pos[0]+pos[1];
const rounded = n => Number(n.toFixed(8));

function weekBank(start, count, visit) {
  LOSS_FIT.families.forEach((family, f) => {
    for (let k=0; k<count; k++) {
      const world = createFleetWeek({family, seed:start+f*count+k}), frames = [];
      while (!world.done) {
        frames.push({...uncertaintyFrame(world.observe()), placements:[]});
        world.step("W|W");
      }
      visit(frames);
    }
  });
}
function board(frame, pos) {
  const i = indexOf(pos);
  if (!frame.placements[i]) {
    const c = candidateOnFrame(frame, fleetWeekActions({...frame.obs, positions:pos}), override);
    c.inputs = lossInputs(frame, c, uncertainty);
    frame.placements[i] = c;
  }
  return frame.placements[i];
}

// Propagate the exact released constant-penalty policy on this same exogenous
// tape, preserving truck order even when the future action breaks a tie by ID.
function paired(start, count, visit) {
  weekBank(start, count, frames => {
    let futureNet = new Float64Array(9), futureService = new Float64Array(9);
    for (let t=frames.length-1; t>=0; t--) {
      const net = new Float64Array(9), service = new Float64Array(9);
      for (const [i, pos] of ordered.entries()) {
        const c = board(frames[t], pos);
        const a = c.proposal && c.inputs.suffixId===c.proposal.id ? c.proposal : c.planner;
        const next = indexOf(a.positions);
        net[i] = a.net+futureNet[next]; service[i] = a.served+futureService[next];
        if (!c.proposal || pos[0]>pos[1]) continue;
        const p = indexOf(c.proposal.positions), r = indexOf(c.planner.positions);
        visit(c.inputs, c.proposal.net+futureNet[p]-c.planner.net-futureNet[r],
          c.proposal.served+futureService[p]-c.planner.served-futureService[r]);
      }
      futureNet=net; futureService=service;
    }
  });
}
function normalEquations() {
  let gram, rhs, n=0;
  return {
    add(x, targets) {
      gram ??= Array.from(x, () => new Float64Array(x.length));
      rhs ??= targets.map(() => new Float64Array(x.length));
      for (let i=0; i<x.length; i++) {
        if (!x[i]) continue;
        for (let j=0; j<=i; j++) gram[i][j]+=x[i]*x[j];
        for (let k=0; k<targets.length; k++) rhs[k][i]+=x[i]*targets[k];
      }
      n++;
    },
    finish() {return {weights:solveFleetRidge(gram,rhs,n,LOSS_FIT.ridge), n};},
  };
}
function fitHeads(start) {
  const common = normalEquations(), losses = normalEquations(), nonLosses = normalEquations();
  let ties=0;
  paired(start, LOSS_FIT.fitCount, (c,net,service) => {
    const isLoss = net<0;
    common.add(c.x, [Number(isLoss)-c.outlook.loss, service-c.legacyService]);
    if (isLoss) losses.add(c.x, [-net-c.outlook.cost]);
    else nonLosses.add(c.x, [net-c.outlook.gain]);
    ties+=Number(net===0);
  });
  const {weights:[classLoss,service],n} = common.finish();
  const negative = losses.finish(), positive = nonLosses.finish();
  return {classLoss, service, lossAmount:negative.weights[0], nonLossAmount:positive.weights[0],
    fitExamples:n,fitLosses:negative.n,fitTies:ties};
}

export function calibrateBins(counts, losses) {
  const blocks=[];
  for (let i=0; i<10; i++) {
    let block = {first:i,last:i,n:counts[i]+LOSS_FIT.binPrior,
      losses:losses[i]+LOSS_FIT.binPrior*(i+0.5)/10};
    while (blocks.length) {
      const prev=blocks.at(-1);
      if (prev.losses/prev.n <= block.losses/block.n) break;
      blocks.pop();
      block={first:prev.first,last:i,n:prev.n+block.n,losses:prev.losses+block.losses};
    }
    blocks.push(block);
  }
  const means=[];
  for (const block of blocks) for (let i=block.first; i<=block.last; i++) means[i]=block.losses/block.n;
  return means;
}
function calibrate(start, model) {
  const binCounts=Array(10).fill(0),binLosses=Array(10).fill(0);
  paired(start, LOSS_FIT.calibrationCount, (c,net) => {
    const p=rawLossEstimate(c,model), i=Math.min(9,Math.floor(10*p));
    binCounts[i]++; binLosses[i]+=Number(net<0);
  });
  const sum=values=>values.reduce((a,b)=>a+b,0);
  return {binCounts, binLosses, calibrationExamples:sum(binCounts),
    globalLossRate:sum(binLosses)/sum(binCounts), calibratedBins:calibrateBins(binCounts,binLosses)};
}

export function lossSettings() {
  const options=[{blend:1,serviceCredit:0,hurdle:0,plannerOnly:true}];
  for (const blend of LOSS_FIT.blends) for (const serviceCredit of LOSS_FIT.serviceCredits)
    for (const hurdle of LOSS_FIT.hurdles) options.push({blend,serviceCredit,hurdle,plannerOnly:false});
  return options;
}
function select(start, model) {
  const options=lossSettings(), sums=options.map(()=>({net:0,netSq:0,served:0,servedSq:0,overrides:0}));
  let n=0;
  weekBank(start, LOSS_FIT.selectionCount, frames => {
    n++;
    let referenceNet,referenceService;
    for (const [i,settings] of options.entries()) {
      let pos=[0,1],net=0,served=0;
      for (const frame of frames) {
        const c=board(frame,pos);
        let a=c.planner;
        if (c.proposal && !settings.plannerOnly) {
          c.fitted ??= lossEstimate(c.inputs,model);
          if (lossDecision(c,c.fitted,settings,model.globalLossRate).chosenId===c.proposal.id) {
            a=c.proposal; sums[i].overrides++;
          }
        }
        net+=a.net;served+=a.served;pos=a.positions;
      }
      if (i===0) {referenceNet=net;referenceService=served;}
      const d=net-referenceNet, s=served-referenceService;
      sums[i].net+=d;sums[i].netSq+=d*d;sums[i].served+=s;sums[i].servedSq+=s*s;
    }
  });
  const lower=(sum,sq)=>rounded(sum/n-Math.sqrt(Math.max(0,sq-sum*sum/n)/(n*(n-1))));
  const candidates=sums.map((s,i)=>({settings:options[i],net:rounded(s.net/n),service:rounded(s.served/n),
    netLowerSE:lower(s.net,s.netSq),serviceLowerSE:lower(s.served,s.servedSq),overrides:s.overrides}));
  const feasible=candidates.filter(row=>row.serviceLowerSE>=0);
  const selected=feasible.reduce((best,row)=>row.netLowerSE>best.netLowerSE ? row : best);
  return {settings:selected.settings,selection:{weeks:n,candidates,feasible:feasible.length}};
}
export function fitLoss(seed) {
  const i=LOSS_FIT.seeds.indexOf(seed);
  if (i<0) throw RangeError("Unknown loss fit seed");
  const trainStart=LOSS_FIT.start+i*LOSS_FIT.stride;
  const calibrationStart=trainStart+LOSS_FIT.calibrationOffset,selectionStart=trainStart+LOSS_FIT.selectionOffset;
  const heads=fitHeads(trainStart);
  const model={...heads,...calibrate(calibrationStart,heads)};
  return {format:"fleet-loss-mc-v1",seed,overrideHash,uncertaintyHash,trainStart,calibrationStart,selectionStart,
    fitWeeks:LOSS_FIT.families.length*LOSS_FIT.fitCount,calibrationWeeks:LOSS_FIT.families.length*LOSS_FIT.calibrationCount,
    ...model,...select(selectionStart,model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,which]=process.argv.slice(2);
  if (!["--write","--check"].includes(mode)) throw Error("Choose --write or --check followed by an optional registered seed");
  const dir=new URL("loss/",data);
  if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const seed of which===undefined ? LOSS_FIT.seeds : [Number(which)]) {
    const model=fitLoss(seed), file=new URL("model-"+seed+".json",dir), bytes=JSON.stringify(model)+"\n";
    if (mode==="--write") writeFileSync(file,bytes);
    else assert.equal(bytes,readFileSync(file,"utf8"),"Checkpoint mismatch");
    console.log(mode,seed,model.fitExamples,"pairs,",model.calibrationExamples,"for calibration,",model.settings);
  }
}
