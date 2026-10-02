import { state, uid } from './store.js';
import { conv, disp } from './fx.js';
import { todayISO } from './format.js';

/** Acima desta retenção na fonte, o excedente normalmente não é dedutível em Portugal (convenções). */
export const HIGH_WITHHOLDING = 0.15;

export const dividendsFor = posId => state.dividends.filter(d => d.posId === posId);
export const netOf = d => d.gross - d.withheld;

/** Dividendos líquidos recebidos de uma posição, na moeda indicada. */
export const dividendTotal = (posId, cur) =>
  dividendsFor(posId).reduce((s, d) => s + conv(netOf(d), d.currency, cur), 0);

export function addDividend(asset, { date, gross, withheld = 0, currency }) {
  const d = {
    id: uid(), posId: asset.id, name: asset.name, symbol: asset.symbol || '', platform: asset.platform || '',
    date, currency, gross, withheld,
  };
  state.dividends.push(d);
  return d;
}

export function removeDividend(id) {
  state.dividends = state.dividends.filter(d => d.id !== id);
}

/** Ações/ETFs que podem ter dividendos: as abertas e as já vendidas (uma entrada por posição). */
export function dividendAssets() {
  const out = new Map();
  for (const p of state.positions) if (p.kind === 'stock') out.set(p.id, { ...p, open: true });
  for (const c of state.closed) {
    const id = c.parentId || c.id;
    if (c.kind === 'stock' && !out.has(id)) out.set(id, { ...c, id, open: false });
  }
  return [...out.values()];
}

/** Dividendos líquidos na moeda de visualização: total e últimos 12 meses. */
export function dividendStats(cur = disp(), now = new Date()) {
  const since = new Date(now);
  since.setFullYear(since.getFullYear() - 1);
  const cutoff = todayISO(since);
  let total = 0, last12 = 0;
  for (const d of state.dividends) {
    const v = conv(netOf(d), d.currency, cur);
    total += v;
    if (d.date >= cutoff) last12 += v;
  }
  return { total, last12, count: state.dividends.length };
}
