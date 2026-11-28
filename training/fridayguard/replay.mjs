import assert from "node:assert/strict";
import {FLEET_DEPOTS} from "../../docs/lib/fleetweek.js";
import {incidentText,traceClosure} from "../../docs/lib/closure-view.js";
import {dispatchText,roundName} from "../../docs/lib/overnight-view.js";
import {table} from "../fleetweek/render-decisions.mjs";

const outcomes={
  prevented:"Recovered a Friday pickup", introduced:"Introduced a Friday miss",
  surrendered:"Gave up a Friday save", newGain:"Found a new Friday save",
};
function replay(fit,kind,e) {
  const keys=["candidate","previous","frozen73"], names=["New fit "+fit,"Frozen fit 101","Original fit 73"];
  const paths=keys.map(key=>{
    const path=traceClosure(e,e[key].actions);
    assert.deepEqual(path.ledger,e[key].ledger);
    return path;
  });
  const {epoch,warningEpoch}=e;
  assert([8,9].includes(epoch));
  const dispatched=paths.map(p=>Boolean(p.trace[epoch].action.served));
  const truth={prevented:[true,false,true],introduced:[false,true,true],surrendered:[false,true,false],newGain:[true,false,false]};
  assert.deepEqual(dispatched,truth[kind]);
  const warning=paths[0].trace[warningEpoch].observation, friday=paths[0].trace[epoch].observation;
  assert.equal(warning.incident.status,"warning");
  const target=friday.orders.find(o=>o.id==="C"), route=FLEET_DEPOTS[target.origin]+" → "+FLEET_DEPOTS[target.destination];
  const ledgers=paths.map((p,i)=>[names[i],dispatchText(p.trace[warningEpoch]),p.trace[epoch].observation.positions.map(v=>FLEET_DEPOTS[v]).join(" / "),
    dispatched[i]?"Delivered":"Missed",p.ledger.served+" / 10",p.ledger.net]);
  const journey=paths[0].trace.map((f,t)=>[roundName(t),incidentText(f.observation.incident),...paths.map(p=>{
    const f=p.trace[t];return dispatchText(f)+" · "+(f.action.served?"contract delivered":"contract missed")+" · "+f.action.net+" net";
  })]);
  return '<details class="week-trace" id="replay-'+fit+'-'+kind+'"><summary>'+outcomes[kind]+' · fit '+fit+' · week '+e.seed+'</summary>'+
    '<p>At the '+roundName(warningEpoch)+' warning, the trucks were at '+warning.positions.map(v=>FLEET_DEPOTS[v]).join(' and ')+'. '+incidentText(warning.incident)+
    '. The signed '+roundName(epoch)+' pickup ran '+route+' for '+target.revenue+' credits.</p>'+
    table("Identical freight and repairs, different dispatches",["Policy","Warning dispatch","Trucks at Friday pickup","Friday contract","Week delivered","Week credits"],ledgers)+
    '<details><summary>Follow both trucks through ten rounds</summary>'+table("Dispatch and contract service in each half-day",["Round","Public notice",...names],journey,"journey")+'</details></details>';
}
export function fitReplays(fits) {
  const groups=fits.flatMap(f=>Object.entries(outcomes).flatMap(([kind])=>{
    const e=f.examples[kind];return e?[replay(f.seed,kind,e)]:[];
  }));
  return groups.length?'<h3>Replay a changed Friday pickup</h3><p>Each replay is the first fresh example of that outcome for its fit, in the fixed benchmark order.</p>'+groups.join("\n"):
    '<p>The fits made identical Friday pickups to the default across this bank.</p>';
}
