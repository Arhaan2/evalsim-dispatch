export function installStudyWorker({directory, splits, verify}) {
  let verifiedCases;
  self.onmessage = async ({data}) => {
    try {
      if (data.type === "week") {
        if (!Number.isSafeInteger(data.index) || !verifiedCases?.[data.index]) throw Error("Choose a verified week.");
        const {rl, planner} = verifiedCases[data.index];
        self.postMessage({type:"week", index:data.index, reference:{rl,planner}});
        return;
      }
      const report = data.report, split = report?.split;
      if (!splits.includes(split)) throw Error("Unknown evaluation split.");
      const path = name => new URL("../data/" + directory + "/" + name + ".json", import.meta.url);
      const [metadata, response] = await Promise.all([fetch(path("results")), fetch(path(split))]);
      if (!metadata.ok || !response.ok) throw Error("The public reference scores could not be loaded.");
      const {banks} = await metadata.json();
      const bytes = await response.arrayBuffer();
      const digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const digest = Array.from(digestBytes, value => value.toString(16).padStart(2, "0")).join("");
      if (digest !== banks[split]) throw Error("Reference scores failed the published digest check.");
      const bank = JSON.parse(new TextDecoder().decode(bytes));
      verify(report, null, bank);
      verifiedCases = bank.cases;
      self.postMessage({type:"verified"});
    } catch (error) {
      self.postMessage({error:error.message});
    }
  };
}
