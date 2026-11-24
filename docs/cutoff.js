import { CUTOFF_VERSION, availableCalls, createShift, noCheck, observeShift, planner, stepShift, verifyShift } from './lib/cutoff.js';
import { chooseCutoff } from './lib/cutoff-policy.js';
import { TRACE_FORMAT } from './lib/lab.js';

const el = id => document.getElementById(id);
const repository = 'https://github.com/Arhaan2/evalsim-dispatch';
const caseNames = ['A', 'B'];
const familyNames = { uncertain: 'Stale inventory', urgent: 'Confirmed inventory' };
const splitNames = { train: 'Training layouts', validation: 'Validation layouts', test: 'Held-out layouts' };
const defaultConfig = { seed: 42, split: 'test', family: 'uncertain', variant: 0 };
const completed = new Map();
let config, shift, history;
let operators = [['Planner', planner], ['Skip inspection', noCheck]];

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function readLink() {
  const params = new URL(location.href).searchParams;
  const seed = params.get('seed') ?? String(defaultConfig.seed);
  const variant = params.get('variant') ?? String(defaultConfig.variant);
  const family = params.get('family') ?? defaultConfig.family;
  const split = params.get('split') ?? defaultConfig.split;
  if (!/^\d{1,10}$/.test(seed) || Number(seed) > 0xffffffff || !['0', '1'].includes(variant) ||
      !Object.hasOwn(familyNames, family) || !Object.hasOwn(splitNames, split)) throw new Error('Unknown configuration');
  const calls = params.get('actions');
  if (calls && calls.length > 280) throw new Error('Too many actions');
  return { config: { seed: Number(seed), variant: Number(variant), family, split }, actions: calls ? calls.split(',') : [] };
}

function runUrl() {
  const url = new URL(location.href);
  url.hash = '';
  url.search = new URLSearchParams(Object.entries(config));
  if (history.length) url.searchParams.set('actions', history.map(d => d.id).join(','));
  return url;
}

function setUrl() {
  const url = runUrl();
  url.hash = location.hash;
  window.history.replaceState(null, '', url);
}

function setCase(next, actions = []) {
  config = { ...next };
  shift = createShift(config);
  history = [];
  for (const action of actions) takeAction(action);
  for (const [key, value] of Object.entries(config)) el(key).value = String(value);
  el('compare').open = false;
  el('operator-runs').replaceChildren();
  el('status').textContent = '';
  render();
  setUrl();
}

function takeAction(id) {
  const before = observeShift(shift);
  const action = availableCalls(before).find(choice => choice.id === id);
  if (!action) throw new Error('Unavailable shared action');
  const after = stepShift(shift, id);
  history.push({ id, label: action.label, before, after, events: after.events.slice(before.events.length) });
}

function renderTimeline(obs) {
  const { tick, express, localOpens, localCutoff } = obs;
  const end = Math.max(tick, localCutoff);
  const rows = [['', 0, 0], ['Express', 0, express.cutoff], ['Local', localOpens, localCutoff]];
  el('timeline').style.setProperty('--ticks', String(end + 1));
  el('timeline').replaceChildren(...rows.map(([name, open, close]) => {
    const row = element('div', undefined, 'lane');
    row.append(element('span', name));
    for (let t = 0; t <= end; t++) {
      const current = t === tick ? ' now' : '';
      const kind = name === 'Express' ? 'open' : 'later';
      const slot = name ? element('span', '', 'cell' + (open <= t && t <= close ? ' ' + kind : '') + current)
        : element('span', String(t), 'tick' + current);
      row.append(slot);
    }
    return row;
  }));
  const expressState = !express.available ? 'booked' : tick > express.cutoff ? 'closed' : 'available';
  const localState = !obs.localAvailable ? 'booked' : tick > localCutoff ? 'closed' : tick < localOpens ? 'opens later' : 'available';
  el('clock').textContent = 'Tick ' + tick;
  el('schedule-note').textContent = `Express through tick ${express.cutoff} (${expressState}). Local from tick ${localOpens} to ${localCutoff} (${localState}).`;
}

function renderOrders(obs) {
  el('orders').replaceChildren(...obs.orders.map((order, i) => {
    const yard = obs.yards[i];
    const row = element('div', undefined, 'order');
    const orderLine = element('p');
    orderLine.append(element('strong', order.name), `${order.units} units due at tick ${order.deadline}`);
    if (order.assigned) orderLine.append(element('br'), order.delivered ? 'Delivered' : 'In transit');
    const stockLine = element('p');
    stockLine.append(element('strong', yard.name), element('span', `${yard.reportedStock} units · ${yard.confirmed ? 'confirmed' : 'unverified'}`, yard.confirmed ? 'current-report' : 'yard-report'), element('br'), `Express ${order.expressTravel} · local ${order.localTravel} ticks in transit`);
    row.append(orderLine, stockLine);
    return row;
  }));
}

function metricsText(score) {
  return `${score.onTimeUnits}/${score.totalUnits} units on time · ${score.calls} calls · ${score.spend} credits spent`;
}

function pairKey() {
  return [config.seed, config.family, config.split].join('/');
}

function render() {
  const obs = observeShift(shift);
  const last = history.at(-1);
  el('case-label').textContent = `Seed ${config.seed} · Case ${caseNames[config.variant]} · ${familyNames[config.family]} · ${splitNames[config.split]}`;
  el('twin').textContent = `Play the other stock placement (case ${caseNames[1 - config.variant]})`;
  renderTimeline(obs);
  renderOrders(obs);
  el('budget').textContent = `${obs.budget - obs.spent} / ${obs.budget} credits remaining`;
  el('restart').disabled = !history.length;
  const score = obs.done ? verifyShift(shift) : null;
  if (score) {
    const pair = completed.get(pairKey()) ?? [null, null];
    pair[config.variant] = { score, steps: history.map(turn => `Tick ${turn.before.tick} · ${turn.label}`) };
    completed.set(pairKey(), pair);
    if (el('compare').open) renderComparison();
  }
  el('choice-title').textContent = score ? (score.success ? 'Both orders arrived on time' : 'Shift ended with a missed commitment') : 'Choose a dispatch action';
  el('briefing').textContent = score ? `Verified result · ${metricsText(score)}.` : 'Inspection costs 1 tick and 1 credit. Express freight costs 4 credits. A local booking costs 2.';
  const choices = availableCalls(obs);
  el('actions').replaceChildren(...choices.map(choice => {
    const button = element('button', choice.label);
    button.type = 'button';
    button.dataset.action = choice.id;
    return button;
  }));
  if (score) {
    const compare = element('button', 'Compare with the operators', 'affirm');
    compare.type = 'button';
    compare.addEventListener('click', () => { el('compare').open = true; el('compare').querySelector('summary').focus(); });
    el('actions').append(compare);
  }
  el('last-action').textContent = last ? last.events.map(e => e.text).join(' ') : obs.events.at(-1).text;
  el('history').replaceChildren(...history.map(turn => element('li', `Tick ${turn.before.tick} · ${turn.label}. ${turn.events.map(event => event.text).join(' ')}`)));
  if (!history.length) el('history').append(element('li', 'Your first action will appear here.'));
}

function runOperator(decide, variant) {
  const world = createShift({ ...config, variant });
  const steps = [];
  let obs = observeShift(world);
  while (!obs.done) {
    const id = decide(obs);
    const call = availableCalls(obs).find(a => a.id === id);
    if (!call) throw new Error('Operator selected an unavailable call');
    steps.push(`Tick ${obs.tick} · ${call.label}`);
    obs = stepShift(world, id);
  }
  return { steps, score: verifyShift(world) };
}

function table(headers, rows, className) {
  const node = element('table', undefined, className);
  const head = node.createTHead().insertRow();
  for (const name of headers) {
    const col = element('th', name);
    col.scope = 'col';
    head.append(col);
  }
  const body = node.createTBody();
  for (const [label, ...cells] of rows) {
    const row = body.insertRow();
    const th = element('th', label); th.scope = 'row'; row.append(th);
    for (const content of cells) {
      const td = row.insertCell();
      td.append(content);
    }
  }
  return node;
}

function renderComparison() {
  const records = operators.map(([label, decide]) => ({ label, runs: [runOperator(decide, 0), runOperator(decide, 1)] }));
  const played = completed.get(pairKey());
  if (played) records.unshift({ label: 'Your latest finishes', runs: played });
  const results = table(['Operator', 'Case A', 'Case B'], records.map(({ label, runs }) => [label, ...runs.map(run =>
    run ? element('span', `${run.score.onTimeUnits}/${run.score.totalUnits} on time`, run.score.success ? 'response-ok' : 'response-missed') : 'Unplayed')]), 'comparison-table');
  const details = records.map(({ label, runs }) => {
    const group = element('details', undefined, 'policy-details');
    const list = element('ul');
    runs.forEach((run, i) => { if (run) list.append(element('li', `Case ${caseNames[i]} · ${metricsText(run.score)}. ` + run.steps.join(' → '))); });
    group.append(element('summary', label + ' decisions'), list);
    return group;
  });
  el('operator-runs').replaceChildren(results, ...details);
}

function downloadRun() {
  const complete = observeShift(shift).done;
  const payload = { format: TRACE_FORMAT, lab: 'EvalSim DISPATCH · Inventory cutoff', version: CUTOFF_VERSION,
    source: repository, operator: 'human', config: { ...config }, complete, actions: history.map(h => h.id),
    score: complete ? verifyShift(shift) : null, runUrl: runUrl().href, observations: [observeShift(createShift(config)), ...history.map(h => h.after)] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
  const link = element('a');
  link.href = url; link.download = `evalsim-cutoff-${config.seed}-${config.family}-${caseNames[config.variant]}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el('status').textContent = complete ? 'Completed run exported with its verified score.' : 'In-progress run exported with its action history.';
}

async function copyLink() {
  const url = runUrl().href;
  try {
    await navigator.clipboard.writeText(url);
    el('status').textContent = 'Copied a link to this case and your actions.';
  } catch {
    const input = element('input');
    input.readOnly = true; input.value = url; input.setAttribute('aria-label', 'Run link');
    el('status').replaceChildren('Copy this run link ', input); input.focus(); input.select();
  }
}

function connect() {
  el('actions').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    takeAction(button.dataset.action); render(); setUrl();
    el('status').textContent = '';
    el('choice-title').focus({ preventScroll: true });
  });
  el('case-form').addEventListener('submit', event => {
    event.preventDefault();
    const seed = el('seed');
    if (!/^\d{1,10}$/.test(seed.value) || Number(seed.value) > 0xffffffff) {
      seed.setCustomValidity('Use a seed between 0 and 4294967295.'); seed.reportValidity(); return;
    }
    setCase({ seed: Number(seed.value), family: el('family').value, split: el('split').value, variant: Number(el('variant').value) });
    el('choice-title').focus();
  });
  el('seed').addEventListener('input', () => el('seed').setCustomValidity(''));
  el('twin').addEventListener('click', () => { setCase({ ...config, variant: 1 - config.variant }); el('choice-title').focus(); });
  el('restart').addEventListener('click', () => { setCase(config); el('choice-title').focus({ preventScroll: true }); });
  el('compare').addEventListener('toggle', () => { if (el('compare').open) renderComparison(); });
  el('copy').addEventListener('click', copyLink);
  el('export').addEventListener('click', downloadRun);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Could not read ' + path);
  return response.json();
}

function evidenceLink(href, label) {
  const a = element('a', label, 'text-link'); a.href = href; return a;
}

function countRange(counts) {
  const low = Math.min(...counts), high = Math.max(...counts);
  return low === high ? String(low) : `${low}–${high}`;
}

async function loadQwen() {
  const data = await fetchJson('./data/cutoff/qwen.json');
  const { testCases, trainingReplicates, policies, paired } = data.summary;
  const block = el('qwen-evidence'); block.className = 'evidence-block';
  const rows = [['Frozen Qwen', 'frozen'], ['Expert imitation', 'sft'], ['Imitation + RL', 'rl'], ['Skip inspection', 'noCheck'], ['Planner', 'planner']].map(([label, key]) => {
    const policy = policies[key];
    return [label, (100 * policy.successRate).toFixed(1) + '%', policy.successes.join(', ')];
  });
  block.append(element('h3', 'Qwen pilot'), element('p', `A frozen Qwen3-4B decoder scored candidate calls. An adapter learned from expert dispatches and then from delivery rewards. All operators faced the same ${testCases} shifts. The trained rows average ${trainingReplicates} training seeds.`),
    table(['Operator', 'Success', 'Solved per run'], rows, 'metric-table'),
    element('p', `In ${paired.wins} of ${paired.wins + paired.losses + paired.ties} paired comparisons, only imitation + RL succeeded. Imitation alone succeeded in ${paired.losses}. The estimated change was ${(100 * paired.meanDifference).toFixed(1)} percentage points, with a 95% bootstrap interval from ${(100 * paired.interval95[0]).toFixed(1)} to ${(100 * paired.interval95[1]).toFixed(1)}.`),
    evidenceLink('./data/cutoff/qwen.json', 'Read the Qwen measurements ↗'));
  if (data.matchedCpu?.runs?.length) {
    const totals = data.matchedCpu.runs.map(run => run.successes);
    block.insertBefore(element('p', `On these same shifts, ${totals.length} CPU RL checkpoints each solved ${countRange(totals)} of ${testCases}.`), block.lastElementChild);
  }
  const twins = data.behavior.rl;
  block.insertBefore(element('p', `On stale-report twins, each Qwen RL run solved both stock placements in ${countRange(twins.map(run => run.succeededOnBoth))} of ${twins[0].uncertainPairs} pairs.`), block.lastElementChild);
  block.hidden = false;
}

function boot() {
  connect();
  try {
    const shared = readLink(); setCase(shared.config, shared.actions);
  } catch {
    setCase(defaultConfig); el('status').textContent = 'That run link had an unavailable case or action. A fresh shift is open.';
  }
  for (const id of ['shift', 'cases', 'comparison']) el(id).hidden = false;
  el('loading').hidden = true;
  loadCPU().catch(() => { el('cpu-evidence').textContent = 'The published CPU results could not be loaded. You can still play both cases and run the planner.'; });
  loadQwen().catch(() => { el('qwen-evidence').hidden = true; });
}

async function loadCPU() {
  const experiment = await fetchJson('./data/cutoff/results.json');
  const { baselines, checkpoints, summary, protocol } = experiment;
  const uniform = checkpoints.uniform.weights;
  const progress = checkpoints.progress.weights;
  operators = [['Uniform RL', obs => chooseCutoff(obs, uniform)], ['Progress curriculum RL', obs => chooseCutoff(obs, progress)], ['Planner', planner], ['Skip inspection', noCheck]];
  if (el('compare').open) renderComparison();
  const percent = ratio => (ratio * 100).toFixed(1).replace(/\.0$/, '') + '%';
  const median = values => {
    const sorted = [...values].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    return sorted[Math.floor(sorted.length / 2)] ?? 'unreached';
  };
  const rows = [['Untrained', percent(baselines.untrained.successes / baselines.untrained.cases)], ['Skip inspection', percent(baselines.noCheck.successes / baselines.noCheck.cases)],
    ['Planner', percent(baselines.planner.successes / baselines.planner.cases)], ['Uniform RL', percent(summary.uniform.meanSuccess)], ['Progress curriculum RL', percent(summary.progress.meanSuccess)]];
  const block = el('cpu-evidence'); block.className = 'evidence-block';
  block.append(element('h3', 'CPU policies'), element('p', `${baselines.planner.cases} held-out shifts per operator. Success requires both orders on time and a reconciled ledger. The RL rows average ${protocol.trainingSeeds.length} training seeds. The interactive comparison uses training seed ${checkpoints.uniform.seed}.`),
    table(['Operator', 'Shifts solved'], rows, 'metric-table'),
    element('p', `On stale-report twins, each uniform RL checkpoint inspected both yards, changed the express destination and completed both shifts in ${countRange(summary.uniform.inspectedThenSwitchedAndSolvedBoth)} of ${protocol.testPairsPerFamily} pairs.`),
    element('p', `To sustain ${percent(protocol.target)} validation success across ${protocol.consecutiveCheckpoints} checkpoints, uniform practice took a median ${median(summary.uniform.sustainedCalls)} training calls and the progress curriculum took ${median(summary.progress.sustainedCalls)}.`),
    evidenceLink('./data/cutoff/results.json', 'Read the CPU measurements ↗'));
}

boot();
