import { num } from "./freight-view.js";

const markets = [
  { label: "Cold-ending reversals", key: "reversal/cold" },
  { label: "Hot-ending drops", key: "interrupted-drop/hot" },
];

// Counts are for the checkpoint's own openings. The subsequent comparison on
// the page uses the common Tariff opening and has its own eligible population.
export function loadEvidence(study, {grid, note, text, details, money, difference, interval}) {
  const test = study.splits.test;
  const container = document.getElementById("load-mechanism");
  const groups = [
    {label: "Surveys the agent bought", field: "purchases",
      description: "Count each actual purchase at a positive price. Freight change compares these bookings with skipping on exactly the same tape, before subtracting any fee."},
    {label: "If every eligible survey were bought", field: "forced",
      description: "Force a purchase on every positive-price shift with one slot left. This measures how often the freight policy could use a reading, including the readings the agent declined."},
  ];
  function rows(field) {
    return markets.map(({label,key}) => {
      const branch = test.opportunities[key].positive[field];
      return [label,num(branch.runs),num(branch.changed),num(branch.higher),num(branch.lower),num(branch.equal),difference(branch.grossDeltaCents/100)];
    });
  }
  for (const group of groups) {
    const comparison = grid(["Market","Runs","Changed load","Higher freight","Lower freight","Equal freight on change","Total freight change"],
      group.label + " paired with the same agent skipping", rows(group.field));
    if (group.field === "purchases") container.append(text("h3",group.label),note(group.description),comparison);
    else container.append(details(group.label,note(group.description),comparison));
  }
  const archive = study.splits.archive.summary.positive, original = study.splits.retention.summary.all;
  const holdout = Object.entries(test.summary.positiveByStratumEnding).flatMap(([family,endings]) =>
    Object.entries(endings).map(([ending,g])=>[family==="reversal"?"Reversal":"Interrupted drop",ending,num(g.shifts),money(g.mean),
      interval(g.references.rlNever),interval(g.references.planner),interval(g.references.lastslot)]));
  container.append(details("All four fresh endings and earlier checkpoints",
    grid(["Market","Ending","Priced shifts","Agent net","Versus skip [95%]","Versus planner [95%]","Versus previous one-slot agent [95%]"],
      "Full-shift paired earnings at positive prices",holdout),
    note("On archived one-slot study patterns, the agent earned " + money(archive.mean) + " net credits per positive-price shift. Its paired difference from the planner was " + interval(archive.references.planner) + "."),
    note("On the original interrupted drop, the difference from the current planner across all prices was " + interval(original.references.planner) + " credits.")));
}
