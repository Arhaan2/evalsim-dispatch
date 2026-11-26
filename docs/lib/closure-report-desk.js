import {makeCard,validateCard,scorecardBaselines} from "./closure-scorecard.js";
import {replayWeek} from "./closure-view.js";

const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
  b=>b.toString(16).padStart(2,"0")).join("");
export function installClosureReportWorker({suite, splits, verify, page, version}) {
  const baselines=scorecardBaselines(version);
  let verified, reference;
  async function loadBank(split) {
    if (!splits.includes(split)) throw Error("Unknown benchmark split.");
    const url=name=>new URL("../data/"+page+"/"+name+".json",import.meta.url);
    const [meta,response]=await Promise.all([fetch(url("results")),fetch(url(split))]);
    if (!meta.ok || !response.ok) throw Error("Could not load the public benchmark bank.");
    const expected=(await meta.json()).banks[split], bytes=await response.arrayBuffer();
    if (expected!==await sha(bytes)) throw Error("Published bank failed its fingerprint check.");
    return {bank:JSON.parse(new TextDecoder().decode(bytes)),hash:expected};
  }
  self.onmessage=async ({data})=>{
    try {
      if (data.type==="week") {
        const i=data.i;
        if (!Number.isSafeInteger(i) || !verified?.cases[i]) throw Error("Choose a verified week.");
        self.postMessage({type:"week",i,week:replayWeek(reference.cases[i],verified.cases[i].actions,baselines)});
        return;
      }
      let card,bank;
      if (data.type==="shared") {
        card=validateCard(data.card);
        if (card.v!==version) throw Error("This scorecard belongs to a different study.");
        const release=await loadBank(card.split);
        bank=release.bank;
        if (card.bankHash!==release.hash || card.n!==bank.cases.length) throw Error("Scorecard belongs to a different benchmark bank.");
      } else if (data.type==="verify") {
        if (!(data.file instanceof Blob) || data.file.size>12*1024*1024) throw Error("Choose a benchmark JSON report under 12 MB.");
        const bytes=await data.file.arrayBuffer(), report=JSON.parse(new TextDecoder().decode(bytes));
        if (report?.suite!==suite || report.version!==1) throw Error("This report belongs to a different or unsupported study.");
        const release=await loadBank(report.split);
        bank=release.bank;
        verified=verify(report,null,bank);
        reference=bank;
        card=makeCard(verified,bank,release.hash,await sha(bytes),version);
      } else throw Error("Unknown scorecard action.");
      const weeks=card.examples.map(e=>{
        const week=replayWeek(bank.cases[e.i],e.actions,baselines);
        if (Math.sign(week.ledgers[0].net-week.ledgers[1].net)!==e.sign) throw Error("The shared example does not match its result.");
        return week;
      });
      self.postMessage({type:data.type,card,weeks});
    } catch (error) {
      self.postMessage({error:error.message});
    }
  };
}
