import assert from "node:assert/strict";
import {FLEET_DEPOTS} from "../../docs/lib/fleetweek.js";
import {closureProbabilities} from "../../docs/lib/closure-world.js";
import {incidentText,traceClosure} from "../../docs/lib/closure-view.js";
import {roundName,dispatchText,moveName} from "../../docs/lib/overnight-view.js";
import {table,digits,signed} from "../fleetweek/render-decisions.mjs";

const stamp=e=>e.seed+"-"+e.epoch;

const shortVsLong = {base:"shortId", proposal:"longId", names:["Short-trained default","Long-trained alternative"],
    moves:["short-trained default’s move","long-trained agent’s move"], journey:["Short-trained move first","Long-trained move first"]};
const studies = {
  closure: {base:"constantId", proposal:"proposalId", journey:["Constant-penalty move first","Alternative move first"]},
  longrepair: {base:"constantId", proposal:"closureId", names:["Constant penalty","Earlier closure agent"],
    moves:["constant-penalty move","earlier closure agent’s move"], journey:["Constant-penalty move first","Earlier agent’s move first"]},
  shortdefault: shortVsLong,
  longmove: shortVsLong,
  moverecall: shortVsLong,
};
function challenge(e, study) {
  const {base:baseKey,proposal,names:dispatchers,moves,journey:headings}=studies[study];
  const t=e.epoch, selectedDefault=e.chosenId===e[baseKey];
  const paths=(selectedDefault?[e.chosen,e.alternative]:[e.alternative,e.chosen]).map(r=>{
    const path=traceClosure(e,r.actions);
    assert.deepEqual(path.ledger,r.ledger);
    return path;
  });
  const [base,alternative]=paths;
  const board=base.trace[t].observation,{incident}=board;
  assert(["warning","closed"].includes(incident.status));
  assert.equal(base.trace[t].action.id,e[baseKey]);
  assert.equal(alternative.trace[t].action.id,e[proposal]);
  assert.notEqual(base.trace[t].action.id,alternative.trace[t].action.id);
  assert.deepEqual(base.trace.slice(0,t).map(r=>r.action.id),alternative.trace.slice(0,t).map(r=>r.action.id));
  const affected=FLEET_DEPOTS[incident.depot];
  const openChance=closureProbabilities(board);
  const changes=base.trace.filter(({observation},i)=>i===0 || incidentText(observation.incident)!==incidentText(base.trace[i-1].observation.incident));
  const timeline=changes.map(({observation:b})=>roundName(b.epoch)+" · "+incidentText(b.incident)).join("<br>");
  const depotList=FLEET_DEPOTS.map((name,i)=>{
    const status=i===incident.depot ? (incident.status==="closed"?"Closed":"Closing") : "Open";
    return '<li'+(i===incident.depot?' class="affected"':'')+'>'+name+' <span>'+status+'</span></li>';
  }).join("");
  const update=incident.status==="warning" ? "Repairs start "+roundName(incident.start)+". The reopening time is unknown." :
    incident.update ? "The repair crew reports that work is "+(incident.update==="on-track"?"on track.":"delayed.") : "The repair crew has yet to post an update.";
  const chance=t<9 ? " The public forecast puts the chance of closure next round at "+digits(openChance[t+1]*100,0)+"%." : "";
  const trucks=board.positions.map((depot,i)=>{
    const move=base.trace[t].action.moves[i];
    return '<p><strong>Truck '+(i+1)+'</strong> at '+FLEET_DEPOTS[depot]+' · '+(/^(W|E[012])$/.test(move)?"available":moveName(move,board,i))+'</p>';
  }).join("");
  const changed=base.trace[t].action.moves.map((move,i)=>move!==alternative.trace[t].action.moves[i]);
  const names=paths.map(path=>path.trace[t].action.moves.flatMap((move,i)=>changed[i]?["Truck "+(i+1)+" · "+moveName(move,board,i)]:[]).join(" / "));
  const choices=paths.map((path,i)=>{
    const a=path.trace[t].action;
    return '<div class="shift-choice"><button type="button" data-pick="'+i+'" data-net="'+path.ledger.net+'" aria-pressed="false"><strong>'+(dispatchers?dispatchers[i]:names[i])+'</strong>'+(dispatchers?'<span>'+names[i]+'</span>':'')+'<span>'+
      a.emptyMiles+' empty miles · '+a.emptyCost+' travel credits this round</span></button></div>';
  }).join("");
  const stats=table("Same freight through Friday",["Your choice","Week net","On time","Empty miles"],
    paths.map((p,i)=>[dispatchers?dispatchers[i]+' · '+names[i]:names[i],p.ledger.net,p.ledger.served+" / "+p.ledger.contracts,p.ledger.emptyMiles]));
  const journey=table("Both trucks on every round",["Round","Depot notice",...headings],
    base.trace.map(({observation:b},i)=>[roundName(i),incidentText(b.incident),...paths.map(p=>dispatchText(p.trace[i])+" · "+p.trace[i].action.net+" net")]),"journey");
  const difference=alternative.ledger.net-base.ledger.net;
  const finding=difference===0 ? "Both choices earned the same net credits through Friday." :
    (moves?"The "+moves[1]+" earned ":"The alternative earned ")+Math.abs(difference)+(difference>0?" more":" fewer")+" net credits through Friday.";
  const elapsed=dispatchers && incident.status==="closed" ? "Repairs began "+roundName(incident.start)+". " : "";
  const explanation=dispatchers ? ' The new agent chose the '+moves[selectedDefault?0:1]+'. This repair lasted '+e.duration+(e.duration===1?' half-day.':' half-days.')+' Both paths use the new agent on every later decision.</p>' : ' The constant-penalty dispatcher chose “'+names[0]+'”. RL chose “'+names[selectedDefault?0:1]+'”. The released RL agent handled all later decisions on both paths.</p>';
  let forecast="";
  if (study==="longmove" || study==="moverecall") {
    assert(Number.isFinite(e.winProbability) && e.winProbability>=0 && e.winProbability<=1 && Number.isFinite(e.expectedNet));
    forecast='<p>Before this choice, the detector gave the long-trained move a '+digits(100*e.winProbability,1)+
      '% chance of earning more and estimated '+signed(e.expectedNet,2)+' extra credits through Friday, using the short-trained policy on later boards.</p>';
  }
  if (study==="moverecall") {
    assert([e.shortId,e.longId].includes(e.previousChoiceId));
    assert(Number.isFinite(e.previousProbability) && e.previousProbability>=0 && e.previousProbability<=1);
    forecast+='<p>From this same board the previous detector would have '+(e.previousChoiceId===e.longId?'switched to long':'kept short')+
      '. Its estimated chance of a profitable switch was '+digits(e.previousProbability*100,1)+'%.</p>';
  }
  return '<article class="night-case" data-case="'+stamp(e)+'"><h3>'+roundName(t)+'</h3>'+
    '<div class="notice-board"><div><h4>'+affected+(incident.status==="warning"?" will close":" is closed")+'</h4><p>'+elapsed+update+chance+'</p></div>'+
    '<ul class="depot-list" aria-label="Depot status">'+depotList+'</ul></div><div class="fleet-position">'+trucks+'</div>'+
    '<div class="call-row shift-choices" hidden>'+choices+'</div><noscript><p>Choices: '+names.join(" or ")+'.</p></noscript>'+
    '<p class="call-status" role="status"></p><details class="outcome"><summary>Reveal both Friday outcomes</summary><p><strong>'+finding+ '</strong>'+explanation+forecast+stats+
    '<details><summary>Repair timeline and truck log</summary><p>'+timeline+'</p>'+journey+'</details></details>'+
    '<a class="case-link" href="./'+study+'.html?case='+stamp(e)+'#play">Link to this decision</a></article>';
}
export function closurePlay(examples, {study="closure", sampleNote}={}) {
  if (!examples.length) throw Error("The public challenge requires at least one playable decision.");
  const displayRound=e=>studies[study]===shortVsLong ? roundName(e.epoch).slice(0,3)+(e.epoch%2?" PM":" AM") : roundName(e.epoch);
  const options=examples.map(e=>'<option value="'+stamp(e)+'">'+displayRound(e)+' · week '+e.seed+'</option>').join("");
  return '<div class="case-list" hidden><label for="case-select">Choose a week</label><select id="case-select">'+options+'</select></div>'+
    examples.map(e=>challenge(e,study)).join("\n")+'<p class="sample-note">'+(sampleNote??'Each replay shows a result nearest the middle of its group among paired decisions from the first 32 test weeks per schedule. The choices keep the same freight assignments and change empty-truck placement on one round.')+'</p>';
}
