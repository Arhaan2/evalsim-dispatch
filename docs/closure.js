import {installCaseDesk} from "./lib/fleet-case-desk.js";
import {cardMarkup,cardURL,exportCard,parseCardHash,weekMarkup} from "./lib/closure-scorecard.js";

installCaseDesk();
const get=id=>document.getElementById(id);
const desk=get("verify-desk"), input=get("report"), status=get("report-status"), panel=get("verified");
const field=get("report-week"), log=get("report-week-log"), sharing=get("share-status");
desk.hidden=false;
let worker, selected, examples, requested, sharedCard, generation=0;
function start(message,isShared) {
  const target=isShared ? get("shared-card") : panel, feedback=isShared ? get("shared-status") : status;
  const active=new Worker(new URL("./lib/closure-report-worker.js",import.meta.url),{type:"module"});
  if (!isShared) worker=active;
  function fail(reason) {
    target.hidden=true;
    feedback.textContent=(isShared ? "Could not replay this scorecard. " : "Could not verify the report. ")+reason;
    active.terminate();
  }
  active.onerror=()=>fail("The verification worker could not finish.");
  active.onmessage=({data})=>{
    if (!isShared && worker!==active) return;
    if (data.error) {fail(data.error);return;}
    if (data.type==="week") {
      if (data.i!==requested) return;
      log.innerHTML='<h4 tabindex="-1">Week '+data.week.seed+'</h4>'+weekMarkup(data.week);
      log.hidden=false;log.querySelector("h4").focus();return;
    }
    const markup=cardMarkup(data.card,data.weeks,!isShared);
    if (isShared) {
      sharedCard=data.card;target.innerHTML=markup;feedback.textContent=data.weeks.length ? "Replayed the shared examples on the published bank." : "Checked the public bank for this scorecard.";
      active.terminate();
    } else {
      selected=data.card;examples=data.weeks;
      get("report-card").innerHTML=markup;
      feedback.textContent="Verified all "+selected.n.toLocaleString("en-US")+" weeks.";
      if (sharedCard) {
        if (selected.reportHash!==sharedCard.reportHash) feedback.textContent+=" This is a different report from the shared scorecard.";
        else feedback.textContent+=cardURL(selected)===cardURL(sharedCard)
          ? " The original report confirms the shared scores and examples." : " The shared scores or examples differ from the original report.";
      }
      field.max=selected.n;field.value="1";
    }
    target.hidden=false;
  };
  active.postMessage(message);
  return active;
}
let sharedWorker;
function showShared() {
  sharedWorker?.terminate();
  get("shared").hidden=!location.hash.startsWith("#card=");
  if (get("shared").hidden) return;
  sharedCard=null;get("shared-card").hidden=true;
  get("shared-status").textContent="Checking the shared examples against the public bank…";
  get("shared").scrollIntoView({behavior:"instant"});
  try {sharedWorker=start({type:"shared",card:parseCardHash(location.hash)},true);}
  catch {get("shared-status").textContent="Could not read this scorecard link. Ask the sender for a fresh link or their original report.";}
}
showShared();
window.addEventListener("hashchange",showShared);
function reset() {
  generation++;worker?.terminate();worker=null;selected=null;examples=null;requested=null;
  panel.hidden=true;log.hidden=true;status.textContent="";sharing.textContent="";get("share-link").hidden=true;
}
function verifyFile(file) {
  if (!file) return;
  status.textContent="Replaying the report and checking the paired comparisons…";
  try {start({type:"verify",file},false);} catch {status.textContent="Could not launch the report verifier.";}
}
input.addEventListener("change",()=>{reset();verifyFile(input.files[0]);});
const sampleButton=get("try-sample");sampleButton.hidden=false;
sampleButton.onclick=async()=>{
  reset();input.value="";const request=generation;status.textContent="Loading the public sample…";
  try {
    const response=await fetch(new URL("./data/closure/sample-report.json",import.meta.url));
    if (!response.ok) throw Error();
    const file=await response.blob();
    if (request===generation) verifyFile(file);
  } catch {if (request===generation) status.textContent="Could not load the public sample. Try again or choose your own report.";}
};
get("report-replay").onclick=()=>{
  if (!selected || !field.reportValidity()) return;
  requested=field.valueAsNumber-1;
  worker.postMessage({type:"week",i:requested});
};
get("copy-card").onclick=async()=>{
  if (!selected) return;
  const link=cardURL(selected), fallback=get("share-link");
  try {await navigator.clipboard.writeText(link);sharing.textContent="Scorecard link copied.";}
  catch {fallback.value=link;fallback.hidden=false;fallback.focus();fallback.select();sharing.textContent="Select and copy the scorecard link.";}
};
get("download-card").onclick=()=>{
  if (!selected) return;
  const blob=new Blob([exportCard(selected,examples)],{type:"text/html;charset=utf-8"});
  const a=document.createElement("a");const href=URL.createObjectURL(blob);a.href=href;
  a.download="evalsim-closure-"+selected.split+"-scorecard.html";a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  sharing.textContent="Scorecard downloaded with the Friday ledgers and all example rounds.";
};
