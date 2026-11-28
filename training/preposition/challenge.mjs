import assert from "node:assert/strict";
import {FLEET_DEPOTS} from "../../docs/lib/fleetweek.js";
import {incidentText, traceClosure} from "../../docs/lib/closure-view.js";
import {dispatchText, moveName, roundName} from "../../docs/lib/overnight-view.js";
import {table} from "../fleetweek/render-decisions.mjs";

const stamp = e => [e.seed,e.epoch,e.fridayEpoch].join("-");
const name = {
  rl:"Release positioning agent", previous:"Frozen fit 73", illustration:"Illustrative alternative",
  "fit-101":"Secondary positioning fit 101", "fit-211":"Secondary positioning fit 211",
};
const source = e => e.kind === "alternative" ? "Teaching example" :
  e.chosenWho === "rl" ? "Release agent" : name[e.chosenWho];
const title = text => text[0].toUpperCase() + text.slice(1);
const route = load => FLEET_DEPOTS[load.origin] + " → " + FLEET_DEPOTS[load.destination];
const period = t => roundName(t).replace(" morning"," AM").replace(" afternoon"," PM");

function renderWeek(e) {
  const t = e.epoch, friday = e.fridayEpoch;
  assert(friday === 8 || friday === 9);
  const alternatives = [[e.chosen, e.chosenId, e.chosenWho], [e.alternative, e.alternativeId, e.alternativeWho]];
  // Keep the provenance hidden until the reveal. Stable ordering allows visitors to share a board.
  if (e.seed % 2) alternatives.reverse();
  const paths = alternatives.map(([branch, first, who], i) => {
    const path = traceClosure(e, branch.actions);
    assert.deepEqual(path.ledger, branch.ledger);
    assert.equal(path.trace[t].action.id, first);
    assert(Object.hasOwn(name,who));
    return {...path, label:i ? "Plan B" : "Plan A", who:name[who]};
  });
  assert.notEqual(paths[0].trace[t].action.id,paths[1].trace[t].action.id);
  assert.deepEqual(paths[0].trace.slice(0,t).map(f=>f.action.id),paths[1].trace.slice(0,t).map(f=>f.action.id));
  const observed = paths[0].trace[t].observation, depot = FLEET_DEPOTS[observed.incident.depot];
  assert.equal(observed.incident.status,"warning");
  assert.equal(observed.incident.start,t+1);
  const target = paths[0].trace[friday].observation.orders.find(o=>o.id==="C");
  assert.deepEqual(target,paths[1].trace[friday].observation.orders.find(o=>o.id==="C"));
  assert.notEqual(paths[0].trace[friday].action.served,paths[1].trace[friday].action.served);
  const positions = observed.positions.map((p,i)=>'<li>Truck '+(i+1)+' <strong>'+FLEET_DEPOTS[p]+'</strong></li>').join("");
  const forecast = observed.forecast[t+1].map((p,i)=>{
    const pct=Math.round(100*p);
    return '<dt>'+FLEET_DEPOTS[i]+'</dt><dd><span aria-hidden="true" class="track"><i style="--share:'+pct+'%"></i></span>'+pct+'%</dd>';
  }).join("");
  const contract = observed.orders.find(o=>o.id==="C");
  const moves = p=>p.trace[t].action.moves.map((code,i)=>"Truck "+(i+1)+" · "+moveName(code,observed,i));
  const choices = paths.map((p,i)=>{
    const a=p.trace[t].action, delivered=p.trace[friday].action.served;
    const feedback='Your trucks '+(delivered?'delivered':'missed')+' the '+roundName(friday)+' contract from '+FLEET_DEPOTS[target.origin]+' to '+FLEET_DEPOTS[target.destination]+'. '+p.label+' finished the week with '+p.ledger.net+' net credits and '+p.ledger.served+' of 10 contracts delivered.';
    return '<div class="shift-choice"><button type="button" aria-pressed="false" data-pick="'+i+'" data-net="'+p.ledger.net+'" data-feedback="'+feedback+'"><strong>'+p.label+'</strong>'+
      moves(p).map(m=>'<span>'+m+'</span>').join('')+'<span class="choice-cost">'+a.emptyMiles+' empty miles · '+a.net+' net credits this round</span></button></div>';
  }).join('');
  const explanation=paths.map(p=>{
    const frame=p.trace[friday], atOrigin=frame.observation.positions.flatMap((depot,i)=>depot===target.origin?["Truck "+(i+1)]:[]);
    if(!atOrigin.length) return p.label+' had no truck at '+FLEET_DEPOTS[target.origin]+' for pickup.';
    const taking=frame.action.moves.indexOf("C");
    return p.label+' had '+atOrigin.join(' and ')+' at '+FLEET_DEPOTS[target.origin]+'. '+
      (taking>=0?'Truck '+(taking+1)+' took the contract.':'The fleet chose '+dispatchText(frame)+'.');
  }).join(' ');
  const fridayRows=paths.map(p=>[p.label,p.who,p.trace[friday].action.served?"Delivered":"Missed",p.ledger.served+" / 10",p.ledger.net,p.ledger.emptyMiles]);
  const logs=paths[0].trace.map((f,i)=>[period(i)+(i===friday?' · target':''),
    incidentText(f.observation.incident),...paths.map(p=>dispatchText(p.trace[i])+" · "+(p.trace[i].action.served?"contract served":"contract missed")+" · "+p.trace[i].action.net+" net")]);
  const manifest=observed.orders.filter(o=>o.id!=="C").map(o=>(o.id==="S0"?"Spot A":"Spot B")+" · "+route(o)+" · "+o.revenue+" credits").join("<br>");
  const attribution=e.kind==="alternative" ? "One plan illustrates a legal alternative to frozen fit 73. This teaching example shows a possible consequence of dispatching the trucks differently." :
    "These are observed decisions by "+name[e.chosenWho]+" and frozen fit 73. Their warning choices changed the Friday delivery on this particular week.";
  const prePlans=paths.map(p=>'<p><strong>'+p.label+'</strong> · '+moves(p).join('. ')+'.</p>').join('');
  return '<article class="night-case" data-case="'+stamp(e)+'"><h3>'+roundName(t)+' dispatch · '+source(e)+' · week '+e.seed+'</h3>'+
    '<div class="dispatch-board"><div><h4>'+depot+' closes '+roundName(t+1)+'</h4><p>Reopening time unknown. Both trucks can move this round.</p><ul class="truck-list">'+positions+'</ul></div>'+
    '<div><p class="forecast-heading">Next round’s freight hub forecast</p><dl class="forecast">'+forecast+'</dl></div></div>'+
    '<p class="contract-row">Current signed load · <strong>'+route(contract)+'</strong> · '+contract.revenue+' credits</p>'+
    '<details><summary>See today’s spot loads</summary><p>'+manifest+'</p></details>'+
    '<p>Your target is the '+roundName(friday)+' contract. Its route is revealed on Friday. Pick a plan for '+roundName(t)+'.</p>'+
    '<div class="call-row shift-choices" hidden>'+choices+'</div><noscript>'+prePlans+'</noscript>'+
    '<p class="call-status" role="status"></p><details class="outcome"><summary>Reveal the Friday delivery</summary>'+
    '<p><strong>'+title(roundName(friday))+' · '+route(target)+'</strong> · '+target.revenue+' credits. '+explanation+'</p><p>Both fleets saw the same freight and repair notices. Frozen fit 73 dispatched their trucks after the warning.</p>'+
    table("Friday delivery and full-week ledgers",["Plan","Warning choice by","Target contract","Week delivered","Week net credits","Empty miles"],fridayRows)+
    '<p>'+attribution+'</p><details><summary>Replay both trucks through all ten rounds</summary>'+
    table("Both fleets on the same freight",["Round","Repair notice","Plan A","Plan B"],logs,"journey")+'</details></details>'+
    '<a class="case-link" href="./preposition.html?case='+stamp(e)+'#play">Link to this dispatch</a></article>';
}

export function renderFridayChallenge(examples) {
  assert(examples.length>0);
  assert.equal(new Set(examples.map(stamp)).size,examples.length);
  const options=examples.map(e=>'<option value="'+stamp(e)+'">'+source(e)+' · '+period(e.epoch)+' · week '+e.seed+'</option>').join('');
  return '<div class="case-list" hidden><label for="case-select">Choose a warning shift</label><select id="case-select">'+options+'</select></div>'+
    examples.map(renderWeek).join('\n');
}
