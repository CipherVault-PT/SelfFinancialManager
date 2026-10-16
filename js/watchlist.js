import { state, uid } from './store.js';
import { canConvert, conv } from './fx.js';
import { todayISO } from './format.js';
import { dayMoveAt } from './markets.js';

const finite = v => (Number.isFinite(v) ? v : null);

/** Preço atual de um ativo da lista: { price, cur, dayPct, live, ts, at } (`at`: quando foi a variação do dia). */
export function watchQuote(w) {
  if (w.kind === 'crypto') {
    const q = state.cache.prices[w.coingeckoId], k = String(w.cur || 'EUR').toLowerCase();
    if (q?.[k] > 0) return { price: q[k], cur: w.cur, dayPct: finite(q[`${k}_24h_change`]), live: true, ts: q.ts, at: q.ts };
    if (q?.usd > 0 && canConvert(w.cur)) return { price: conv(q.usd, 'USD', w.cur), cur: w.cur, dayPct: finite(q.usd_24h_change), live: true, ts: q.ts, at: q.ts };
    return { price: null, cur: w.cur, dayPct: null, live: false, ts: null };
  }
  const q = state.cache.stockPrices[w.quoteSymbol];
  return q?.price > 0
    ? { price: q.price, cur: q.cur, dayPct: finite(q.dayPct), live: true, ts: q.ts, at: dayMoveAt(w.quoteSymbol, q) }
    : { price: null, cur: w.quoteCur || null, dayPct: null, live: false, ts: null };
}

const sameAsset = (a, b) => a.kind === b.kind && (a.kind === 'crypto' ? a.coingeckoId === b.coingeckoId : a.quoteSymbol === b.quoteSymbol);

/** Junta um ativo à lista (ou atualiza o que já lá está). Devolve o item. */
export function addWatch(item, quote = null) {
  const old = state.watchlist.find(w => sameAsset(w, item));
  if (old) return Object.assign(old, item, { id: old.id });
  const w = {
    id: uid(), addedAt: todayISO(), target: null, above: false, notify: true, fired: false, note: '',
    ...item,
    ...(quote?.price > 0 ? { addedPrice: quote.price, addedCur: quote.cur } : {}),
  };
  state.watchlist.unshift(w);
  return w;
}

export function updateWatch(id, patch) {
  const w = state.watchlist.find(x => x.id === id);
  if (!w) return null;
  const rearm = 'target' in patch || 'above' in patch;
  return Object.assign(w, patch, rearm ? { fired: false } : {});
}

export function removeWatch(id) {
  const w = state.watchlist.find(x => x.id === id);
  state.watchlist = state.watchlist.filter(x => x.id !== id);
  return w ?? null;
}

/** Distância ao preço-alvo, em % do preço atual (negativa = tem de descer). */
export const toTarget = (w, q) => (w.target > 0 && q.price > 0 ? ((w.target - q.price) / q.price) * 100 : null);

export const reached = (w, q) => w.target > 0 && q.price > 0 && (w.above ? q.price >= w.target : q.price <= w.target);

/** Variação desde que o ativo entrou na lista (na moeda em que cota). */
export function sinceAdded(w, q) {
  if (!(w.addedPrice > 0) || !(q.price > 0) || (w.addedCur && w.addedCur !== q.cur)) return null;
  return ((q.price - w.addedPrice) / w.addedPrice) * 100;
}

/** Avisos de preço-alvo atingido (uma vez por alvo), no formato dos alertas das posições. */
export function checkWatch() {
  const fired = [];
  for (const w of state.watchlist) {
    if (!w.notify || w.fired) continue;
    const q = watchQuote(w);
    if (!q.live || !reached(w, q)) continue;
    w.fired = true;
    fired.push({ name: w.name, above: !!w.above, now: q.price, price: w.target, cur: q.cur });
  }
  return fired;
}
