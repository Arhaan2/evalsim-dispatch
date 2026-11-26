import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {closureActions} from "../../docs/lib/closure-world.js";
import {isClosureDecision,prepareClosureValues} from "../../docs/lib/closure-policy.js";
import {gateAdvantage,uncalibratedAdvantage} from "../../docs/lib/longrepair-policy.js";
import {shortDefaultProposal,chooseShortDefault} from "../../docs/lib/shortdefault-policy.js";
import {historical as previous,historicalHashes as previousHashes,ordered,visitWeeks} from "../longrepair/fit.mjs";
import {solveFleetRidge} from "../fleetweek/fit.mjs";

const data=new URL("../../docs/data/",import.meta.url);
const files={short:"short-13.json",long:"fit-13.json"};
export const digests={...previousHashes,
  short:"75373f8d1a5910b7935459e9c778a265c515187e4e2ce1fa661a09b161ddb6c3",
  long:"765fec6de25af686d94a8b32271cbdbffb9d9a0f672868ff4afab140554b78ee"};
export const weights={...previous};
for (const [name,file] of Object.entries(files)) {
  const bytes=readFileSync(new URL("longrepair/"+file,data));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),digests[name]);
  weights[name]=JSON.parse(bytes);
}
export const CONFIG={seeds:[13,37,73,101,211],base:700000000,stride:1000000,
  fitCount:4096,calibrationCount:1024,selectionCount:2048,calibrationOffset:200000,selectionOffset:400000,
  durations:[1,2,3,4,4,5,5],ridge:0.05,serviceCredits:[0,12,30],hurdles:[0,2,5,10]};
const index=pos=>pos[0]*3+pos[1];
const round=v=>Number(v.toFixed(10));

// Backward induction computes the realized Friday ledger of the frozen short
// policy for each of nine ordered truck placements. Fit on the six canonical
// origins only. Reversed truck order in a subsequent state is kept exactly.
export function tapeTargets(frames,visit) {
  let futureNet=new Float64Array(9),futureService=new Float64Array(9);
  for (let t=9;t>=0;t--) {
    const frame=frames[t],active=isClosureDecision(frame.obs);
    const prepared=active ? prepareClosureValues(frame,weights.closure) : null;
    const net=new Float64Array(9),service=new Float64Array(9);
    for (const [i,positions] of ordered.entries()) {
      const menu=closureActions({...frame.obs,positions}),p=shortDefaultProposal(frame,menu,weights,prepared);
      const a=menu.find(item=>item.id===p.shortId),dest=index(a.positions);
      net[i]=a.net+futureNet[dest];
      service[i]=a.served+futureService[dest];
      if (p.eligible && positions[0]<=positions[1]) {
        const b=menu.find(item=>item.id===p.longId),to=index(b.positions);
        visit(p,[b.net+futureNet[to]-net[i],b.served+futureService[to]-service[i]],t,positions);
      }
    }
    futureNet=net;futureService=service;
  }
}
function collect(start,count) {
  const rows=[];
  let weeks=0;
  visitWeeks(start,count,CONFIG.durations,frames=>{
    weeks++;
    tapeTargets(frames,(p,y)=>rows.push({p,y}));
  });
  assert.equal(weeks,11*count);
  return rows;
}
function regress(rows) {
  const n=rows.length,d=rows[0].p.x.length;
  const center=Array(d).fill(0),scale=Array(d).fill(0);
  for (const {p} of rows) for (let j=1;j<d;j++) center[j]+=p.x[j]/n;
  for (const {p} of rows) for (let j=1;j<d;j++) scale[j]+=(p.x[j]-center[j])**2/n;
  for (let j=0;j<d;j++) {
    const sd=Math.sqrt(scale[j]);
    scale[j]=sd>1e-8 ? round(sd) : 1;
    center[j]=round(center[j]);
  }
  const gram=Array.from({length:d},()=>new Float64Array(d)),rhs=[new Float64Array(d),new Float64Array(d)];
  for (const {p,y} of rows) {
    const z=p.x.map((v,j)=>(v-center[j])/scale[j]);
    for (let i=0;i<d;i++) {
      rhs[0][i]+=z[i]*(y[0]-p.priorNet);rhs[1][i]+=z[i]*(y[1]-p.priorService);
      for (let j=0;j<=i;j++) gram[i][j]+=z[i]*z[j];
    }
  }
  const [net,service]=solveFleetRidge(gram,rhs,n,CONFIG.ridge);
  return {center,scale,net,service,fitExamples:n,longTookClosure:rows.filter(({p})=>p.longId===p.closureId).length};
}
function calibrate(rows,model) {
  const raw=rows.map(({p})=>uncalibratedAdvantage(p,model));
  const heads=[0,1].map(j=>{
    const n=rows.length,mean=rows.reduce((s,{y})=>s+y[j],0)/n,predictedMean=raw.reduce((s,v)=>s+v[j],0)/n;
    let xy=0,xx=0;
    for (const [i,{y}] of rows.entries()) {
      const dx=raw[i][j]-predictedMean;
      xy+=dx*(y[j]-mean);xx+=dx*dx;
    }
    return {mean:round(mean),predictedMean:round(predictedMean),slope:round(xx>0 ? Math.max(0,Math.min(1.5,xy/xx)) : 0)};
  });
  return {net:heads[0],service:heads[1],examples:rows.length};
}
export function settingsGrid() {
  const out=[{shortOnly:true,serviceCredit:0,hurdle:0}];
  for (const serviceCredit of CONFIG.serviceCredits) for (const hurdle of CONFIG.hurdles) {
    out.push({shortOnly:false,serviceCredit,hurdle});
  }
  return out;
}
function summary(sum,ss,n) {
  const mean=sum/n;
  return {mean:round(mean),lowerSE:round(mean-Math.sqrt(Math.max(0,ss-mean*sum)/(n*(n-1))))};
}
function select(start,model) {
  const grid=settingsGrid(),totals=grid.map(()=>({switches:0,net:0,netSS:0,served:0,servedSS:0}));
  let n=0;
  visitWeeks(start,CONFIG.selectionCount,CONFIG.durations,frames=>{
    const cache=frames.map(()=>({positions:[],prepared:null}));
    function lookup(t,pos) {
      const c=cache[t],i=index(pos),f=frames[t];
      if (!c.positions[i]) {
        if (isClosureDecision(f.obs)) c.prepared??=prepareClosureValues(f,weights.closure);
        const menu=closureActions({...f.obs,positions:pos}),p=shortDefaultProposal(f,menu,weights,c.prepared);
        c.positions[i]={menu,p,advantage:gateAdvantage(p,model)};
      }
      return c.positions[i];
    }
    let baseNet,baseServed;
    grid.forEach((settings,i)=>{
      let pos=[0,1],net=0,served=0;
      for (let t=0;t<10;t++) {
        const {menu,p,advantage}=lookup(t,pos);
        const selected=chooseShortDefault(p,advantage,settings);
        const a=menu.find(move=>move.id===selected.chosenId);
        if (a.id!==p.shortId) totals[i].switches++;
        net+=a.net;served+=a.served;pos=a.positions;
      }
      if (i===0) {baseNet=net;baseServed=served;}
      const delta=net-baseNet,d=served-baseServed,sum=totals[i];
      sum.net+=delta;sum.netSS+=delta*delta;sum.served+=d;sum.servedSS+=d*d;
    });
    n++;
  });
  const candidates=totals.map((s,i)=>({settings:grid[i],switches:s.switches,
    netShort:summary(s.net,s.netSS,n),serviceShort:summary(s.served,s.servedSS,n)}));
  const feasible=candidates.filter(c=>c.netShort.lowerSE>0 && c.serviceShort.mean>=0);
  const chosen=feasible.reduce((a,b)=>b.netShort.lowerSE>a.netShort.lowerSE ? b : a,candidates[0]);
  return {settings:chosen.settings,selection:{weeks:n,feasible:feasible.length,candidates}};
}
function fit(seed) {
  const i=CONFIG.seeds.indexOf(seed);assert(i>=0,"Unregistered seed");
  const trainStart=CONFIG.base+i*CONFIG.stride,calibrationStart=trainStart+CONFIG.calibrationOffset,
    selectionStart=trainStart+CONFIG.selectionOffset;
  const model=regress(collect(trainStart,CONFIG.fitCount));
  model.calibration=calibrate(collect(calibrationStart,CONFIG.calibrationCount),model);
  return {format:"fleet-shortdefault-mc-v1",seed,historicalHashes:digests,trainStart,calibrationStart,selectionStart,
    fitWeeks:11*CONFIG.fitCount,calibrationWeeks:11*CONFIG.calibrationCount,...model,...select(selectionStart,model)};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,which]=process.argv.slice(2);
  assert(["--write","--check"].includes(mode),"Choose --write or --check, optionally followed by a registered seed");
  const dir=new URL("shortdefault/",data);
  if (mode==="--write") mkdirSync(dir,{recursive:true});
  for (const seed of which===undefined ? CONFIG.seeds : [Number(which)]) {
    const m=fit(seed),text=JSON.stringify(m)+"\n",file=new URL("fit-"+seed+".json",dir);
    if (mode==="--write") writeFileSync(file,text);
    else assert.equal(readFileSync(file,"utf8"),text,"Checkpoint mismatch");
    console.log(mode,seed,m.fitExamples,"disagreements;",m.calibration.examples,"calibration pairs;",m.settings);
  }
}
