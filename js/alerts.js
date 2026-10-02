import { state, uid } from './store.js';
import { priceInfo } from './calc.js';
import { conv } from './fx.js';

export const alertsFor = posId => state.alerts.filter(a => a.posId === posId);

export function addAlert(p, { above, price, cur }) {
  state.alerts.push({ id: uid(), posId: p.id, name: p.name, cur, above, price, active: true });
}

export function removeAlert(id) {
  state.alerts = state.alerts.filter(a => a.id !== id);
}

export function dropAlertsFor(posId) {
  state.alerts = state.alerts.filter(a => a.posId !== posId);
}

/**
 * Verifica os alertas ativos com o preço atual convertido para a moeda do alerta.
 * Devolve os alertas disparados (já marcados como inativos).
 */
export function checkAlerts() {
  const fired = [];
  for (const a of state.alerts) {
    if (!a.active) continue;
    const p = state.positions.find(x => x.id === a.posId);
    if (!p) continue;
    const pi = priceInfo(p);
    if (!pi.live) continue;
    const now = conv(pi.price, pi.cur, a.cur);
    if (!(now > 0)) continue;
    if (a.above ? now >= a.price : now <= a.price) {
      a.active = false;
      fired.push({ ...a, now });
    }
  }
  return fired;
}
