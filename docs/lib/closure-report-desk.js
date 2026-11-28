import {makeCard,validateCard,scorecardBaselines} from "./closure-scorecard.js";
import {replayWeek} from "./closure-view.js";

const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
  b=>b.toString(16).padStart(2,"0")).join("");
export function installClosureReportWorker({suite, splits, verify, page, version, loadCaseBank, maxReportMiB = 12}) {
  const baselines=scorecardBaselines(version);
  let verified, reference;
  async function loadBank(split,indices) {
    if (!splits.includes(split)) throw Error("Unknown benchmark split.");
    const root=new URL("../data/"+page+"/",import.meta.url);
    const getFile=async name=>{
      const response=await fetch(new URL(name,root));
      if (!response.ok) throw Error("Could not load the public benchmark bank.");
      return response;
    };
    const meta=await (await getFile("results.json")).json();
    const hash=meta.banks[split];
    async function readVerifiedJSON(name,expected) {
      const bytes=await (await getFile(name)).arrayBuffer();
      if (await sha(bytes)!==expected) throw Error("Published bank failed its fingerprint check.");
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    const bank=loadCaseBank ? await loadCaseBank(split,readVerifiedJSON,hash,indices) : await readVerifiedJSON(split+".json",hash);
    return {bank,hash};
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
        const release=await loadBank(card.split,card.examples.map(e=>e.i));
        bank=release.bank;
        if (card.bankHash!==release.hash || card.n!==bank.cases.length) throw Error("Scorecard belongs to a different benchmark bank.");
      } else if (data.type==="verify") {
        if (!(data.file instanceof Blob) || data.file.size>maxReportMiB*1024*1024) throw Error("Choose a benchmark JSON report under "+maxReportMiB+" MiB.");
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
