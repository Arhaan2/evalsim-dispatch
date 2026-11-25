import {verifyOvernightReport, OVERNIGHT_SPLITS} from "./overnight-benchmark.js";
let verifiedCases;
self.onmessage = async ({data}) => {
  try {
    if(data.type==="week") {
      if(!Number.isSafeInteger(data.index) || !verifiedCases?.[data.index]) throw Error("Choose a verified week.");
      const {rl,planner}=verifiedCases[data.index];
      self.postMessage({type:"week",index:data.index,reference:{rl,planner}});return;
    }
    const report=data.report, split=report?.split;
    if(!OVERNIGHT_SPLITS.includes(split)) throw Error("Unknown overnight evaluation split.");
    const path = name=>new URL("../data/overnight/"+name+".json",import.meta.url);
    const [metadata, response]=await Promise.all([fetch(path("results")),fetch(path(split))]);
    if(!metadata.ok || !response.ok) throw Error("The public reference scores could not be loaded.");
    const {banks}=await metadata.json(), bytes=await response.arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
    if(digest!==banks[split]) throw Error("Reference scores failed the published digest check.");
    const bank=JSON.parse(new TextDecoder().decode(bytes));
    verifyOvernightReport(report,null,bank);verifiedCases=bank.cases;
    self.postMessage({type:"verified"});
  }catch(error){self.postMessage({error:error.message});}
};
