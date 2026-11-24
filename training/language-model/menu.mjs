import { availableActions } from '../../docs/lib/world.js';
import { LABELS } from './adapter.mjs';

export function toolMenu(obs) {
  const all = availableActions(obs);
  const bookings = all.filter(a => a.tool === 'book_shipment');
  const actions = new Map();
  // Two earliest-deadline bookings from each warehouse, with different customers.
  for (const [i, yard] of obs.warehouses.entries()) {
    const candidates = bookings.filter(a => obs.routes.find(r => r.id === a.route).source === yard.id);
    candidates.sort((a, b) => {
      const deadline = id => obs.orders.find(o => o.id === id).deadline;
      return deadline(a.order) - deadline(b.order) || a.order.localeCompare(b.order);
    });
    candidates.slice(0, 2).forEach((a, k) => actions.set(i * 2 + k, a));
  }
  const inspection = all.filter(a => a.tool === 'query_inventory').sort((a, b) => {
    const age = id => obs.warehouses.find(w => w.id === id).observedAt;
    return age(a.warehouse) - age(b.warehouse);
  })[0];
  if (inspection) actions.set(4, inspection);
  const lookup = all.find(a => a.tool === 'check_transport_capacity') ?? all.find(a => a.tool === 'check_supplier_status');
  if (lookup) actions.set(5, lookup);
  const purchase = all.find(a => a.tool === 'purchase_inventory');
  if (purchase) actions.set(6, purchase);
  actions.set(7, { tool: 'advance_time' });
  return actions;
}

export function promptFor(obs, menu) {
  const rows = [
    'Deliver all goods by their deadlines within budget. Only arrivals count. Choose the next tool by its letter.',
    'Every fourth call advances time. An explicit wait advances it immediately. Reports may be stale.',
    'Tick ' + obs.tick + '/' + obs.horizon + ', remaining budget ' + obs.budget + ', decisions ' + obs.decisions + '/' + obs.decisionLimit + '.',
    'Orders (id, destination, demand, arrived, in transit, deadline):',
    ...obs.orders.map(o => [o.id, o.customer, o.demand, o.delivered, o.inTransit, o.deadline].join(' ')),
    'Stock (yard, reported free, as of tick): ' + obs.warehouses.map(w => [w.id, w.reportedStock, w.observedAt].join(' ')).join(' | '),
    'Transit: ' + (obs.shipments.filter(s => s.status === 'in-transit').map(s => s.quantity+' to '+s.destination+' ETA '+s.arrival).join(', ') || 'none'),
    'Recent reports: ' + (obs.events.slice(-3).map(e => e.message).join(' ') || 'none'),
    'Choices:'
  ];
  for (const [slot, a] of menu) {
    let details = Object.entries(a).filter(([key]) => key !== 'tool').map(([, value]) => value).join(' ');
    if (a.tool === 'book_shipment') {
      const r = obs.routes.find(route => route.id === a.route);
      details += ' (cost '+a.quantity * r.cost+', ETA '+(obs.tick + r.travel)+')';
    }
    if (a.tool === 'purchase_inventory') {
      const s = obs.suppliers.find(supplier => supplier.id === a.supplier);
      details += ' (to '+s.warehouse+', cost '+a.quantity*s.cost+', ETA '+(obs.tick+s.eta)+')';
    }
    rows.push(LABELS[slot]+'. '+a.tool+' '+details.trim());
  }
  return '<|im_start|>system\nYou dispatch freight in Meridian Harbor. Reply with exactly one available letter.<|im_end|>\n<|im_start|>user\n'+rows.join('\n')+'<|im_end|>\n<|im_start|>assistant\n';
}
