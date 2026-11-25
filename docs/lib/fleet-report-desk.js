import {traceActions, roundName, familyName, dispatchText} from "./overnight-view.js";
const byId = id => document.getElementById(id);
const fmt = (n,d=2) => n.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});

export function installReportDesk({workerUrl,agentName}) {
  byId("verify-desk").hidden=false;
  const input = byId("report"), weekNumber = byId("report-week");
  let activeWorker, submitted, generation=0, requested;
  function fail(message) {
    byId("verified").hidden=true;
    byId("report-week-log").hidden=true;
    byId("report-status").textContent="Could not verify the report. "+message;
  }
  function el(tag,text) {
    const node=document.createElement(tag);
    if (text!==undefined) node.textContent=text;
    return node;
  }
  function reportTable(title,headings,rows,cls="") {
    const wrap=el("div");wrap.className="table-frame";wrap.tabIndex=0;wrap.setAttribute("role","region");wrap.setAttribute("aria-label",title);
    const table=el("table");table.className=cls;table.append(el("caption",title));
    const thead=el("thead"),head=el("tr");
    for (const name of headings) {const th=el("th",name);th.scope="col";head.append(th);}
    thead.append(head);table.append(thead);
    const body=el("tbody");
    for (const row of rows) {
      const tr=el("tr"), first=el("th",row[0]);first.scope="row";tr.append(first);
      for (const value of row.slice(1)) tr.append(el("td",value));
      body.append(tr);
    }
    table.append(body);wrap.append(table);return wrap;
  }
  function showWeek(row,reference) {
    const names=["Your agent",agentName,"Planner"];
    const policies=[row,reference.rl,reference.planner];
    const traces=policies.map(p=>traceActions(row,p.actions));
    const title=el("h3",familyName(row.family)+" · week "+row.seed);title.tabIndex=-1;
    const final=reportTable("All ten rounds",["Dispatcher","Week net","On time","Empty miles"],
      traces.map((run,i)=>[names[i],run.ledger.net,run.ledger.served+" / 10",run.ledger.emptyMiles]));
    const journey=reportTable("Truck 1 and truck 2, followed by net credits that round",["Round",...names],
      traces[0].trace.map((frame,t)=>[roundName(t),...traces.map(r=>{
        const current=r.trace[t];return dispatchText(current)+" · "+current.action.net+" net";
      })]),"journey");
    const area=byId("report-week-log");area.replaceChildren(title,final,journey);area.hidden=false;title.focus();
  }
  input.addEventListener("change",async()=>{
    const iteration=++generation, file=input.files[0];
    activeWorker?.terminate();activeWorker=null;submitted=null;requested=null;
    byId("verified").hidden=true;byId("report-week-log").hidden=true;byId("report-status").textContent="";
    if (!file) return;
    try {
      if (file.size>12*1024*1024) throw Error("Use a benchmark JSON report under 12 MB.");
      byId("report-status").textContent="Replaying the report and checking the paired results…";
      const report=JSON.parse(await file.text());
      if(iteration!==generation) return;
      const worker = new Worker(workerUrl,{type:"module"});
      activeWorker=worker;
      worker.onerror=()=>{if(iteration===generation)fail("The replay worker could not finish.");worker.terminate();};
      worker.onmessage=({data})=>{
        if(iteration!==generation) return;
        if(data.error){fail(data.error);worker.terminate();return;}
        if(data.type==="week") {
          if(data.index===requested) showWeek(report.cases[data.index],data.reference);
          return;
        }
        submitted=report;
        const all=report.summary.all, p=all.policies.agent, pair=all.comparisons.planner;
        byId("report-status").textContent="Verified all "+report.cases.length.toLocaleString("en-US")+" weeks in the "+report.split+" report for "+report.policy+".";
        byId("report-summary").textContent=fmt(p.net)+" net credits per week and "+fmt(p.onTime)+"% on time. Compared with the planner, the differences were "+
          fmt(pair.net)+" credits (95% interval "+pair.net95.map(n=>fmt(n)).join(" to ")+") and "+fmt(pair.servicePP,3)+
          " percentage points ("+pair.service95.map(n=>fmt(n,3)).join(" to ")+").";
        weekNumber.max=report.cases.length;weekNumber.value=1;byId("verified").hidden=false;
      };
      worker.postMessage({type:"verify",report});
    } catch(error){if(iteration===generation)fail(error.message);}
  });
  byId("report-replay").onclick=()=>{
    if(!submitted || !weekNumber.reportValidity()) return;
    requested=weekNumber.valueAsNumber-1;
    if(!submitted.cases[requested]) return;
    activeWorker.postMessage({type:"week",index:requested});
  };
}
