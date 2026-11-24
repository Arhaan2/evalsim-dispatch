import { num, scrollTable, signed, table, text } from "./freight-view.js";
import { dataRow } from "./demand-desk.js";

const strata = { reversal: "Reversals", "interrupted-drop": "Interrupted drops" };
export const interval = pair => signed(pair.delta) + " [" + pair.interval95.map(signed).join(", ") + "]";
export const note = value => Object.assign(text("p", value), { className: "result-note" });

export function pairedDesk({ suite, patterns, world, policies, names, compareKeys, extraSplits }) {
  const test = suite.splits.test;

  // Number the fresh cases in a seed-dependent order. Visitors can share and
  // replay a case without the scenario's hot/cold label appearing at the desk.
  function caseOrder(seed) {
    const families = [...test.families];
    let state = seed >>> 0;
    for (let i = families.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = Math.floor((state / 4294967296) * (i + 1));
      [families[i], families[j]] = [families[j], families[i]];
    }
    for (const split of extraSplits) families.push(...suite.splits[split].families);
    return families;
  }

  const picker = {
    initialSeed() { return test.start + crypto.getRandomValues(new Uint32Array(1))[0] % test.count; },
    decode(choice, seed) { return /^[1-9]\d*$/.test(choice) ? caseOrder(seed)[Number(choice) - 1] : undefined; },
    select(select, config) {
      const order = caseOrder(config.seed);
      const current = order.indexOf(config.family) + 1;
      const options = test.families.map((_, i) => new Option("Case " + (i + 1), String(i + 1)));
      if (current > options.length) options.push(new Option("Case " + current, String(current)));
      select.replaceChildren(...options);
      select.value = String(current);
    },
    url(config, actions = [], hash = "") {
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("case", String(caseOrder(config.seed).indexOf(config.family) + 1));
      url.searchParams.set("seed", String(config.seed));
      if (actions.length) url.searchParams.set("actions", actions.join(","));
      url.hash = hash;
      return url;
    },
  };

  function replayScore(config, decide) {
    const state = world.create(config);
    while (!state.done) world.step(state, decide(world.observe(state)));
    const score = world.verify(state);
    if (score.violations.length) throw new Error("The matched shift did not reconcile.");
    return score.net;
  }

  function renderPair(target, config, weights) {
    const pattern = patterns[config.family];
    const otherEnding = pattern.ending === "hot" ? "cold" : "hot";
    const other = { family: pattern.stem + "-" + otherEnding, seed: config.seed };
    if (!Object.hasOwn(patterns, other.family)) return;
    const here = world.create(config).trueHighChances, there = world.create(other).trueHighChances;
    const common = here.findIndex((chance, i) => chance !== there[i]);
    const pair = document.createElement("section");
    pair.id = "paired-endings";
    pair.append(text("h3", "One opening, two endings"),
      note("These shifts share the first " + common + " waves. This case closes " + pattern.ending
        + ". Its matched case uses the same market draws with a " + otherEnding + " finish."));
    const refs = policies(weights);
    const active = compareKeys.filter(key => refs[key]);
    const grid = table(["Ending", "Final high-offer chance", ...active.map(key => names[key])], "Matched hot and cold endings, in net credits per shift");
    const body = grid.createTBody();
    for (const [settings, odds, label] of [[config, here, pattern.ending], [other, there, otherEnding]]) {
      dataRow(body, [label === "hot" ? "Hot" : "Cold", num(100 * odds.at(-1)) + "%", ...active.map(key => num(replayScore(settings, refs[key])))]);
    }
    const links = document.createElement("div");
    links.className = "section-links";
    const twin = text("a", "Play the " + otherEnding + "-ending twin →");
    twin.href = picker.url(other, [], "session");
    links.append(twin);
    pair.append(scrollTable(grid), links);
    target.prepend(pair);
  }

  function reportGroups(groups, summary) {
    const grid = table(["Your agent", "Shifts", ...compareKeys.map(key => "Versus " + names[key])],
      "Your agent’s mean paired differences in net credits with 95% intervals");
    const body = grid.createTBody();
    for (const [stratum, group] of Object.entries(groups)) {
      const row = (name, g) => dataRow(body, [name, num(g.shifts), ...compareKeys.map(key => interval(g.references[key]))]);
      row(strata[stratum], group);
      for (const [ending, sub] of Object.entries(summary.byStratumEnding[stratum])) row(strata[stratum] + " · " + ending, sub);
    }
    const details = document.createElement("details");
    details.append(text("summary", "Compare your agent by pattern and ending"), scrollTable(grid));
    return details;
  }
  return { picker, renderPair, reportGroups };
}
