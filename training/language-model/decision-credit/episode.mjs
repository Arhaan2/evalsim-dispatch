import {createWorld, dispatcher, makeScenario, observe, step} from '../../../docs/lib/world.js';
import {LABELS, choose, distribution, initAdapter, project, randomStream} from '../adapter.mjs';
import {promptFor, toolMenu} from '../menu.mjs';
import {counterfactuals, improve, metrics, protocol} from './credit.mjs';

export async function episode({seed,family,mode,state,encode,random,capture=false}) {
  const world = createWorld(makeScenario(seed,family));
  const actions = [], credits = [], updates = [], choices = [], trace = [];
  const training = mode === 'collect';
  let batch = [];
  let branchToolCalls = 0, branchCount = 0;
  while (!world.done) {
    const obs = observe(world);
    let action, offered = null;
    if (mode === 'dispatcher') {
      action = dispatcher(obs);
    } else {
      const menu = toolMenu(obs);
      const slots = [...menu.keys()];
      let selected = 0, probabilities = [1];
      if (slots.length > 1) {
        const {h,logits} = await encode(promptFor(obs,menu));
        state.adapter ??= initAdapter(h.length, randomStream(protocol.trainingSeed));
        const projected = mode === 'base' ? Array(state.adapter.rank).fill(0) : project(state.adapter,h);
        probabilities = distribution(logits,projected,state.adapter,slots,training ? protocol.behaviorTemperature : 1);
        selected = choose(probabilities,training ? random : undefined);
        if (training) {
          const audit = counterfactuals(world,menu);
          credits.push({decision:obs.decisions,slots,returns:audit.returns,toolCalls:audit.toolCalls});
          branchToolCalls += audit.toolCalls;
          branchCount += audit.returns.length;
          batch.push({hidden:h,logits,slots,returns:audit.returns});
        }
      }
      action = menu.get(slots[selected]);
      if (!training) choices.push({slots,probabilities,selected:slots[selected]});
      if (capture) offered = slots.map((slot,i) => ({label:LABELS[slot],action:menu.get(slot),probability:probabilities[i]}));
    }
    const out = step(world,action);
    actions.push(action);
    if (capture) trace.push({tick:obs.tick,action,result:out.message,ok:out.ok,events:out.events,choices:offered,
      observation:{budget:obs.budget,orders:obs.orders,warehouses:obs.warehouses}});
    if (training && batch.length && (batch.length === protocol.batchDecisions || world.done)) {
      updates.push(improve(state.adapter,batch,state.optimizer));
      batch = [];
    }
  }
  return {metrics:metrics(world),actions,choices,trace,credits,updates,branchToolCalls,branchCount};
}
