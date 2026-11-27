import {interval} from "./repair-tables.mjs";
import {table,count,signed} from "../fleetweek/render-decisions.mjs";

export function verdict(c) {
  if (!c.wins && !c.losses) return "Tied on every week";
  if (c.net95[0]>0) return "Release earned more";
  if (c.net95[1]<0) return "Release earned less";
  return "Inconclusive";
}
export function defaultTable(title, rows) {
  return table(title,["Group","Weeks","Credits/week vs short [95% interval]","On-time pp vs short [95% interval]",
    "Credits/week vs long [95% interval]","Credits/week vs constant [95% interval]","Credits/week vs planner [95% interval]"],
  rows.map(([label,g])=>[label,count(g.weeks),interval(g.comparisons.shortGate),interval(g.comparisons.shortGate,true),
    interval(g.comparisons.longGate),interval(g.comparisons.flatRisk),interval(g.comparisons.planner)]));
}

export function primaryTable({shortGate:short,planner,flatRisk:base,previous}, previousName="Previous detector") {
  const rows=[["Short-trained default",short],["Rolling planner",planner],["Constant penalty",base]];
  if (previous) rows.unshift([previousName,previous]);
  const primary=table("Fresh earnings and on-time service",["Release compared with","Earnings difference","Service difference"],
    rows.map(([name,c])=>
      [name,interval(c)+" credits/week<br><strong>"+verdict(c)+"</strong>",interval(c,true)+" pp"]),"default-comparisons");
  return primary;
}
export function allFitTables(fresh,models,primarySeed) {
  const fits=table("All five agents on the same fresh weeks",["Training seed","Selected dispatch rule","Credits vs short","On-time pp vs short","Credits vs long","Credits vs planner","On-time pp vs planner","Credits vs constant","On-time pp vs constant"],
    fresh.fits.map(f=>[f.seed+(f.seed===primarySeed?" · release":""),models.get(f.seed).settings.shortOnly?"Always short":"Can switch",interval(f.shortGate),interval(f.shortGate,true),
      interval(f.longGate),interval(f.planner),interval(f.planner,true),interval(f.flatRisk),interval(f.flatRisk,true)]));
  const longFits=table("Five fits on actual four- and five-half-day repairs",["Training seed","Credits vs short","On-time pp vs short","Credits vs long","On-time pp vs long"],
    fresh.fits.map(f=>[f.seed+(f.seed===primarySeed?" · release":""),interval(f.longRepairs.shortGate),interval(f.longRepairs.shortGate,true),
      interval(f.longRepairs.longGate),interval(f.longRepairs.longGate,true)]));
  return {fits,longFits};
}
export function decisionTables(d,{service=false}={}) {
  const decisions=table("Earnings from changing one decision",["Release choice","Decisions","Earned more","Tied","Earned less","Mean credits over other move",...(service?["Mean on-time pp over other move"]:[])],
    [["Took long",d.outcomes.adopted],["Kept short",d.outcomes.deferred]].map(([label,o])=>
      [label,count(o.wins+o.ties+o.losses),count(o.wins),count(o.ties),count(o.losses),o.net===null?"No decisions":signed(o.net,3),...(service?[o.servicePP===null?"No decisions":signed(o.servicePP,3)]:[])]));
  const eachLength=table("Where the dispatchers disagreed",["Repair length","Disagreements","Kept short","Took long"],
    Object.entries(d.byDuration).map(([n,v])=>[n+(n==="1"?" half-day":" half-days"),count(v.eligible),count(v.deferred),count(v.switched)]));
  return {decisions,eachLength};
}
