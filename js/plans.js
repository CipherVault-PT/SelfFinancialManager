import { state, validPlan } from './store.js';
import { conv } from './fx.js';
import { feeFor } from './calc.js';
import { todayISO } from './format.js';

/**
 * Planos de poupança: uma compra mensal de valor fixo numa posição (ex: 100 € de VWCE no dia 2).
 * A app não compra nada sozinha — quando chega o dia, pede para confirmar o preço e as unidades.
 */
export const MAX_DAY = 28;

const pad = n => String(n).padStart(2, '0');
const clampDay = d => Math.min(MAX_DAY, Math.max(1, Math.round(+d) || 1));

/** Mesmo dia no mês seguinte. */
export function nextMonth(iso, day) {
  const [y, m] = iso.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-${pad(clampDay(day))}`;
}

/** Primeira data do plano: este mês se o dia ainda não passou, senão o próximo. */
export function firstDue(day, today = todayISO()) {
  const d = clampDay(day), [y, m, td] = today.split('-').map(Number);
  const here = `${y}-${pad(m)}-${pad(d)}`;
  return td <= d ? here : nextMonth(here, d);
}

export { validPlan };

export function setPlan(p, { amount, day, source = 'new' }, today = todayISO()) {
  const d = clampDay(day);
  const keepNext = p.plan?.day === d && validPlan(p.plan) ? p.plan.next : firstDue(d, today);
  p.plan = { amount: +amount, day: d, source, next: keepNext };
  return p.plan;
}

export function stopPlan(p) { delete p.plan; }

/** Compras de planos em atraso ou de hoje (a mais antiga de cada posição). */
export function plansDue(today = todayISO()) {
  return state.positions
    .filter(p => validPlan(p.plan) && p.plan.next <= today)
    .map(p => ({ p, date: p.plan.next }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Passa o plano para o mês seguinte (depois de confirmar ou saltar a compra). */
export function advancePlan(p) {
  if (validPlan(p.plan)) p.plan.next = nextMonth(p.plan.next, p.plan.day);
}

/**
 * Unidades estimadas para um valor na moeda da conta, ao preço indicado (na moeda de cotação).
 * Inclui a taxa de câmbio da corretora quando as moedas são diferentes.
 */
export function estimateUnits(p, amount, price, priceCur) {
  if (!(amount > 0) || !(price > 0)) return 0;
  const cross = priceCur !== p.currency;
  const inQuote = conv(amount, p.currency, priceCur) * (cross ? 1 - feeFor(p.platform) : 1);
  return inQuote / price;
}

/** Total mensal dos planos ativos, na moeda indicada. */
export const plansMonthly = cur => state.positions
  .filter(p => validPlan(p.plan))
  .reduce((s, p) => s + conv(p.plan.amount, p.currency, cur), 0);
