import { num } from "./freight-view.js";
import { loadEvidence } from "./loadchoice-view.js";

const markets = [
  {label:"Cold-ending reversals",key:"reversal/cold"},
  {label:"Hot-ending drops",key:"interrupted-drop/hot"},
];

export function explainGuard(guard) {
  const recommendation = guard.reverted ? "book this offer" : "keep waiting";
  return "The previous rule would wait here and the blind rule would book. Estimated freight gain from waiting is " +
    num(guard.meanWaitGain,3) + " credits, with " + num(100*guard.lossProbability,1) +
    "% chance of a lower-paying load. Estimated downside, averaged across all outcomes, is " +
    num(guard.meanDownside,3) + " credits. After its learned adjustment the wait advantage is " +
    num(guard.score,3) + " credits, so the agent would " + recommendation + ".";
}

export function waitEvidence(study,ui) {
  const {grid,note,text,details,difference,interval}=ui;
  const container=document.getElementById("wait-mechanism");
  const test=study.splits.test;
  function evidence(field) {
    const timing=[],interventions=[],blanket=[];
    for(const {label,key} of markets) {
      const branch=test.opportunities[key].positive[field],w=branch.wait;
      timing.push([label,"Previous rule",num(branch.runs),num(w.unguardedLater),num(w.unguardedHarmful),num(w.unguardedBeneficial)],
        [label,"With wait check",num(branch.runs),num(w.guardedLater),num(w.guardedHarmful),num(w.guardedBeneficial)]);
      blanket.push([label,num(w.opportunitiesToStop),num(w.worthwhileStops),num(w.missedSavings),num(w.unnecessaryStops),difference(w.blanketGainCents/100)]);
      interventions.push([label,num(w.interventions),num(w.saved),num(w.costly),num(w.tied),difference(w.guardGainCents/100)]);
    }
    return [
      grid(["Market","Booking rule","Priced cases","Booked later than skip","Lower freight","Higher freight"],
        "Bookings made later than the same blind agent on identical freight",timing),
      grid(["Market","Changed by wait check","Earned more","Earned less","Same pay","Total freight change"],
        "Effect of the wait check relative to the previous freight rule with the same survey",interventions),
      grid(["Market","Early bookings available","Would earn more","Profitable stops missed","Stops with no gain","Freight change if always stopped"],
        "Selective stopping compared with taking every available early booking",blanket)
    ];
  }
  const changes=markets.map(({label,key})=>{
    const [type,end]=key.split("/");
    const refs=test.summary.positiveByStratumEnding[type][end].references;
    return [label,interval(refs.unguarded),interval(refs.alwaysStop),interval(refs.loadchoice)];
  });
  const archivedHot=study.splits.archive.summary.positiveByStratumEnding["interrupted-drop"].hot;
  container.replaceChildren(text("h3","What happened after a paid reading"),
    note("A costly wait books a later wave than the blind agent and earns less freight. A useful wait books later and earns more. Both rules below buy the same survey on the same shift."),
    ...evidence("purchases"),note("An early booking is available when the blind agent would book and the surveyed rule would wait. The blanket rule books at every such disagreement. Each rule pays the same fee here, so a change in freight is also a change in net credits."),
    details("Force a reading on every eligible shift",note("These counterfactuals also include one-slot openings where the agent chose to skip."),...evidence("forced")),
    details("Compare with the previous agent",note("The first two controls share this agent’s purchase decisions. One keeps the previous freight rule and the other books at every disagreement. The published load-choice agent makes its own purchases."),
      grid(["Market","Versus previous freight rule [95%]","Versus always stop [95%]","Versus previous full policy [95%]"],"Net credits per offered shift at six positive fees",changes),
      note("On the previous study’s hot-ending drop schedules with fresh seeds, this agent earned " + interval(archivedHot.references.planner) + " credits per priced shift relative to the planner and " + interval(archivedHot.references.rlNever) + " relative to skipping.")));
  loadEvidence(study,ui,{key:"loadchoice",label:"previous load-choice agent",archive:"load-choice study"});
}
