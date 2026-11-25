import {verifyFleetReport} from "./fleetweek-benchmark.js";
import {FLEET_SPLITS} from "./fleetweek-study.js";
self.onmessage = async ({data:{report,digest}}) => {
  try {
    if (!FLEET_SPLITS.includes(report?.split)) throw Error("Unknown split.");
    const response = await fetch(new URL("../data/fleetweek/" + report.split + ".json",import.meta.url));
    if (!response.ok) throw Error("Reference data unavailable.");
    const bytes=await response.arrayBuffer();
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
    if (actual !== digest) throw Error("Reference data failed its release check.");
    verifyFleetReport(report,null,JSON.parse(new TextDecoder().decode(bytes)));
    self.postMessage({ok:true});
  } catch(e) {self.postMessage({error:e.message});}
};
