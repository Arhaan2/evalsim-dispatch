import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {FLEET_DEPOTS} from "../../docs/lib/fleetweek.js";
import {branchLabel, dispatchText, familyName, moveName, roundName, traceActions} from "../../docs/lib/overnight-view.js";

const docs = new URL("../../docs/", import.meta.url);
export const digits = (value, places = 2) => value.toLocaleString("en-US", {minimumFractionDigits:places, maximumFractionDigits:places});
export const count = value => digits(value, 0);
export const signed = (value, places = 2) => (value > 0 ? "+" : "") + digits(value, places);
export const percentage = value => digits(value) + "%";
const creditWord = n => n === 1 ? " credit" : " credits";
export const stamp = item => [item.seed, item.epoch].join("-");

export function comparison(row, service = false) {
  const [point, bounds, places] = service ? [row.servicePP, row.service95, 3] : [row.net, row.net95, 2];
  return signed(point, places) + " [" + bounds.map(value => signed(value, places)).join(", ") + "]";
}

export function sentenceForDelta(delta) {
  if (delta === 0) return "earned exactly as much as the rolling planner";
  return "earned " + digits(Math.abs(delta)) + (delta > 0 ? " more" : " fewer") + " net credits per week than the rolling planner";
}

export function table(caption, headings, rows, className = "") {
  const head = headings.map(value => '<th scope="col">' + value + '</th>').join("");
  const body = rows.map(([first, ...rest]) => '<tr><th scope="row">' + first + '</th>' +
    rest.map(value => '<td>' + value + '</td>').join("") + '</tr>').join("");
  return '<div class="table-frame" role="region" tabindex="0" aria-label="' + caption + '"><table class="' + className +
    '"><caption>' + caption + '</caption><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

export function renderCase(example, page, estimatesMarkup, outcomeNote = "") {
  const {seed, epoch, family} = example;
  const accepted = example.choice === "accept";
  const branches = (accepted ? [example.alternative, example.chosen] : [example.chosen, example.alternative])
    .map(path => traceActions({seed, family}, path.actions));
  const [plan, proposal] = branches;
  const board = plan.trace[epoch].observation;
  assert.equal(plan.trace[epoch].action.id, example.plannerId);
  assert.equal(proposal.trace[epoch].action.id, example.proposalId);
  const forecast = board.forecast[epoch + 1].map((p, depot) => {
    const percent = Math.round(100 * p) + "%";
    return '<dt>' + FLEET_DEPOTS[depot] + '</dt><dd><span class="track" aria-hidden="true"><i style="--share:' +
      percent + '"></i></span><span>' + percent + '</span></dd>';
  }).join("");
  const trucks = board.positions.map((p, i) => {
    const current = plan.trace[epoch].action.moves[i];
    const signedLoad = current === "W" || current.startsWith("E") ? "available" : moveName(current, board, i);
    return '<p>Truck ' + (i + 1) + ' at ' + FLEET_DEPOTS[p] + ' · ' + signedLoad + '</p>';
  }).join("");
  const choiceNames = ["Keep the plan", "Override"];
  const options = branches.map((path, i) => {
    const frame = path.trace[epoch];
    const price = frame.action.emptyCost;
    return {name:choiceNames[i], label:branchLabel(frame) + " · " + price + creditWord(price), net:path.ledger.net};
  });
  const decisions = options.map((option, i) => '<div class="shift-choice"><button type="button" data-pick="' +
    (i === 0 ? "planner" : "override") + '" data-net="' + option.net + '" aria-pressed="false"><strong>' +
    option.name + '</strong><span>' + option.label + '</span></button></div>').join("");
  const where = example.choice === "accept" ? "overrode the planner" : "kept the planner’s move";
  const net = proposal.ledger.net - plan.ledger.net;
  const service = proposal.ledger.served - plan.ledger.served;
  const outcome = net === 0 ? "Both choices earned the same amount through Friday." :
    "Overriding the planner earned " + count(Math.abs(net)) + (net > 0 ? " more" : " fewer") + " net credits through Friday.";
  const impact = service === 0 ? "Both served the same number of contracts." :
    "The override served " + count(Math.abs(service)) + (service > 0 ? " more" : " fewer") + (Math.abs(service) === 1 ? " contract." : " contracts.");
  const totals = table("Same freight through Friday", ["Tonight’s choice", "Empty trip cost", "Next morning’s net", "Week net", "On time"],
    branches.map((path,i) => [choiceNames[i], count(path.trace[epoch].action.emptyCost), count(path.trace[epoch + 1].action.net), count(path.ledger.net), path.ledger.served + " / 10"]));
  const journey = table("Actions for truck 1 and truck 2", ["Round", "Keep the plan", "Override"], plan.trace.map((_, t) =>
    [roundName(t), ...branches.map(path => dispatchText(path.trace[t]) + " · " + path.trace[t].action.net + " net")]), "journey");
  const observed = [...board.history.map(item => item.hub), board.hub].map(hub => FLEET_DEPOTS[hub]).join(" → ");
  return '<article class="night-case" data-case="' + stamp(example) + '"><h3>' + roundName(epoch) + '</h3>' +
    '<div class="manifest"><div><h4>Trucks and signed loads</h4>' + trucks + '</div><div><h4>Next morning’s demand forecast</h4><dl class="forecast">' + forecast + '</dl></div></div>' +
    estimatesMarkup(example, observed) +
    '<div class="call-row shift-choices" hidden>' + decisions + '</div><noscript><ul>' + options.map(option => '<li>' + option.name + ' · ' + option.label + '</li>').join("") + '</ul></noscript>' +
    '<p class="call-status" role="status"></p><details class="outcome"><summary>Reveal both Friday outcomes</summary><p><strong>' + outcome + '</strong> ' + impact +
    ' The trained agent ' + where + '.' + outcomeNote + '</p>' + totals + '<details><summary>Follow both trucks through all ten rounds</summary>' + journey +
    '</details><p class="sample-note">Week ' + seed + ' · ' + familyName(family) + '</p></details><a class="case-link" href="' + page + '?case=' +
    stamp(example) + '#replays">Link to this night</a></article>';
}

export async function writeSections(study, file, blocks) {
  const path = new URL(file, docs), before = await readFile(path, "utf8");
  let after = before;
  for (const [marker, content] of Object.entries(blocks)) {
    const start = '<!-- ' + study + '-' + marker + '-start -->', end = '<!-- ' + study + '-' + marker + '-end -->';
    const a = after.indexOf(start), b = after.indexOf(end);
    assert(a >= 0 && b > a, file + " is missing its " + marker + " section");
    after = after.slice(0, a + start.length) + "\n" + content + "\n" + after.slice(b);
  }
  if (process.argv.includes("--check")) assert.equal(after, before, file + " differs from measured results");
  else await writeFile(path, after);
}
