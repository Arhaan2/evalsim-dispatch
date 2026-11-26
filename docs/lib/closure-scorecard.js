// Public scorecard links carry the sender's aggregate and two replayable action lists.
// A recipient can reconstruct the examples from the public case bank without a server.
import {familyName} from "./overnight-view.js";

export const CARD_VERSION = "closure-v1.0.0";
export const SPLIT_NAMES = {validation:"Development closures",test:"Fresh closures",clean:"Ordinary weeks",archive:"Original double-return"};
export const LONG_REPAIR_CARD_VERSION = "longrepair-v1.0.0";
export const SHORT_DEFAULT_CARD_VERSION = "shortdefault-v1.0.0";
export const LONG_MOVE_CARD_VERSION = "longmove-v1.0.0";
const baselineLabels = {planner:"Rolling planner",flatRisk:"Constant penalty",shortGate:"Short-trained default"};
const twoBaselines = Object.freeze(["planner","flatRisk"]);
const threeBaselines = Object.freeze([...twoBaselines,"shortGate"]);
const editions = new Map([
  [CARD_VERSION, {page:"closure", title:"Depot closure", reference:"Closure RL", baselines:twoBaselines}],
  [LONG_REPAIR_CARD_VERSION, {page:"longrepair", title:"Longer depot repairs", reference:"Long-repair RL", baselines:twoBaselines}],
  [LONG_MOVE_CARD_VERSION, {page:"longmove", title:"Profitable long moves", reference:"Long-move RL", baselines:threeBaselines}],
  [SHORT_DEFAULT_CARD_VERSION, {page:"shortdefault", title:"Short-trained default", reference:"Short-default RL", baselines:threeBaselines}],
]);
export const scorecardBaselines = version => editions.get(version).baselines;
const pageURL = version => "https://arhaan2.github.io/evalsim-dispatch/"+editions.get(version).page+".html";
const metric = (n,places=3) => n.toLocaleString("en-US",{minimumFractionDigits:places,maximumFractionDigits:places});
const delta = n => (n>0 ? "+" : "")+metric(n);
const text = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const pair = (value,bounds) => delta(value)+" ["+bounds.map(delta).join(", ")+"]";
const digest = value=>typeof value==="string" && /^[a-f0-9]{64}$/.test(value);


export function representativeWeeks(report, bank) {
  const rows = report.cases.map((r,i)=>({i,diff:r.ledger.net-bank.cases[i].planner.ledger.net}));
  return [1,-1].flatMap(sign=>{
    const group=rows.filter(r=>Math.sign(r.diff)===sign);
    if (!group.length) return [];
    const values=group.map(r=>r.diff).sort((a,b)=>a-b);
    const median=(values[(values.length-1)>>1]+values[values.length>>1])/2;
    const selected=group.reduce((best,r)=>Math.abs(r.diff-median)<Math.abs(best.diff-median) ? r : best);
    return [{i:selected.i, sign, actions:report.cases[selected.i].actions}];
  });
}
export function makeCard(report, bank, bankHash, reportHash, version=CARD_VERSION) {
  const {all} = report.summary, {agent} = all.policies;
  const comparisons = scorecardBaselines(version).map(key=>{
    const c = all.comparisons[key];
    return [c.net,...c.net95,c.servicePP,...c.service95];
  });
  const c = all.comparisons.planner;
  return {v:version,split:report.split,policy:report.policy,n:all.weeks,net:agent.net,onTime:agent.onTime,
    comparisons,counts:[c.wins,c.ties,c.losses],examples:representativeWeeks(report,bank),bankHash,reportHash};
}
export function validateCard(c) {
  function require(ok) {if (!ok) throw Error("Invalid or unsupported shared scorecard.");}
  require(c && editions.has(c.v) && typeof c.split==="string" && Object.hasOwn(SPLIT_NAMES,c.split));
  require(typeof c.policy==="string" && c.policy.trim() && c.policy.length<=120);
  require(Number.isSafeInteger(c.n) && c.n>0 && Number.isFinite(c.net) && Number.isFinite(c.onTime) && c.onTime>=0 && c.onTime<=100);
  require(digest(c.bankHash) && digest(c.reportHash));
  require(Array.isArray(c.comparisons) && c.comparisons.length===scorecardBaselines(c.v).length && c.comparisons.every(row=>
    Array.isArray(row) && row.length===6 && row.every(Number.isFinite) && row[1]<=row[2] && row[4]<=row[5]));
  require(Array.isArray(c.counts) && c.counts.length===3 && c.counts.every(n=>Number.isSafeInteger(n) && n>=0) &&
    c.counts.reduce((s,n)=>s+n,0)===c.n);
  const signs = [1,-1].filter((_,i)=>c.counts[i*2]>0);
  require(Array.isArray(c.examples) && c.examples.length===signs.length && c.examples.every((e,i)=>
    e && e.sign===signs[i] && Number.isSafeInteger(e.i) && e.i>=0 && e.i<c.n &&
    Array.isArray(e.actions) && e.actions.length===10 && e.actions.every(id=>typeof id==="string" && /^(W|E[0-2]|C|S[01])\|(W|E[0-2]|C|S[01])$/.test(id))));
  return c;
}
export function cardURL(card) {
  validateCard(card);
  const bytes=new TextEncoder().encode(JSON.stringify(card));
  const base64=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join("")).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
  return pageURL(card.v)+"#card="+base64;
}
export function parseCardHash(hash) {
  if (!/^#card=[A-Za-z0-9_-]{1,6000}$/.test(hash)) throw Error("Invalid or incomplete scorecard link.");
  const binary=atob(hash.slice(6).replaceAll("-","+").replaceAll("_","/"));
  return validateCard(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))));
}
function table(caption, headings, rows) {
  const el = (tag,v,attr="")=>"<"+tag+attr+">"+text(v)+"</"+tag+">";
  return '<div class="table-frame" role="region" tabindex="0" aria-label="'+text(caption)+'"><table><caption>'+text(caption)+'</caption><thead><tr>'+
    headings.map(h=>el("th",h,' scope="col"')).join("")+'</tr></thead><tbody>'+rows.map(([first,...rest])=>"<tr>"+el("th",first,' scope="row"')+
      rest.map(v=>el("td",v)).join("")+"</tr>").join("")+"</tbody></table></div>";
}
export function weekMarkup(week, version=CARD_VERSION) {
  const pathNames=["Submitted agent",...scorecardBaselines(version).map(k=>baselineLabels[k]),editions.get(version).reference];
  return table("Friday ledgers",["Dispatcher","Net credits","On time","Empty miles"],
    week.ledgers.map((l,i)=>[pathNames[i],l.net,l.served+" / "+l.contracts,l.emptyMiles]))+
    '<details><summary>Dispatch log · all ten rounds</summary>'+table("Both trucks on each board",["Round","Depot notice",...pathNames],week.rounds)+"</details>";
}
export function cardMarkup(card, weeks, verified) {
  const c=validateCard(card), [wins,ties,losses]=c.counts;
  const proof=verified ? "Your browser replayed the full report against the published bank." :
    "The sender reports the aggregate scores. Open the original JSON in the lab to verify every week.";
  const examples=weeks.map((w,i)=>{
    const gain=w.ledgers[0].net-w.ledgers[1].net;
    if (Math.sign(gain)!==c.examples[i].sign) throw Error("Shared example has a different outcome from its label.");
    return '<details><summary>'+text((gain>0?"Winning":"Losing")+" week · "+w.seed+" · "+(gain>0?"+":"")+gain+" credits vs planner")+
      '</summary><p>'+text(familyName(w.family))+'</p>'+weekMarkup(w,c.v)+'</details>';
  }).join("");
  return '<article class="score-sheet"><p class="score-context">EvalSim DISPATCH · '+editions.get(c.v).title+'</p><h3>'+text(c.policy)+'</h3>'+
    '<p>'+text(SPLIT_NAMES[c.split])+' · '+c.n.toLocaleString("en-US")+' public weeks · '+c.v+'</p>'+
    '<p class="score-totals"><strong>'+metric(c.net,2)+'</strong> net credits/week &nbsp; <strong>'+metric(c.onTime,2)+'%</strong> on time</p>'+
    table("Agent minus baseline · paired 95% intervals",["Comparison","Difference [95% interval]"],c.comparisons.flatMap((r,i)=>{
      const label=baselineLabels[scorecardBaselines(c.v)[i]];
      return [[label+" · credits/week",pair(r[0],r.slice(1,3))],[label+" · on-time pp",pair(r[3],r.slice(4,6))]];
    }))+
    '<p>'+wins.toLocaleString("en-US")+' wins, '+ties.toLocaleString("en-US")+' ties, '+losses.toLocaleString("en-US")+' losses against the planner.</p>'+
    '<p><strong>Self-benchmarked.</strong> '+proof+'</p>'+
    (examples ? '<h4>Representative week replays</h4><p>Each example is the week nearest the median earnings difference among wins or losses. Manifest order breaks ties.</p>'+examples : '<p>Every week tied the planner on earnings.</p>')+
    '<details><summary>Report and reference fingerprints</summary><p>Original JSON, SHA-256 <code>'+c.reportHash+
    '</code></p><p>Published bank, SHA-256 <code>'+c.bankHash+'</code></p></details></article>';
}
export function exportCard(card,weeks) {
  const css=':root{color:#142b23;background:#f8f8f1;font:16px/1.55 system-ui,sans-serif}main{max-width:65rem;margin:2rem auto;padding:0 1rem}h1,h3{line-height:1.1;letter-spacing:-.035em}h3{font-size:2rem;margin:.4rem 0;overflow-wrap:anywhere}.score-sheet{padding:clamp(.8rem,4vw,2rem);background:#fffefa}.score-context{color:#375146}.score-totals{font-size:1.25rem}a{color:#1d382e}summary{cursor:pointer;padding:.65rem 0;font-weight:600}code{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td,caption{text-align:left;padding:.4rem}th,td{border-bottom:1px solid #bdc8ba;vertical-align:top}.table-frame{max-width:100%;overflow:auto}.score-sheet>.table-frame table{table-layout:fixed;white-space:normal}.score-sheet>.table-frame td,.score-sheet>.table-frame th{overflow-wrap:break-word}a:focus-visible,summary:focus-visible{outline:3px solid #375146}';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><title>'+text(card.policy)+' · '+(card.v===CARD_VERSION?'Closure':editions.get(card.v).title)+' scorecard</title><style>'+css+
    '</style><main><h1>Agent scorecard</h1>'+cardMarkup(card,weeks,false)+'<p><a href="'+text(cardURL(card))+'">Replay the examples on EvalSim</a> · <a href="'+pageURL(card.v)+'#own-agent">Benchmark your dispatcher</a></p></main></html>';
}
