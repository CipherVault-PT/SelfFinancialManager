import { NO_FX_FEE } from './config.js';
import { state } from './store.js';
import { conv, canConvert, fxFresh, disp } from './fx.js';

const finiteOr = (v, d = null) => (Number.isFinite(v) ? v : d);

export function posTotals(p) {
  let shares = 0, cost = 0;
  for (const l of p.lots ?? []) { shares += l.shares || 0; cost += l.cost || 0; }
  return { shares, cost };
}
export const qty = p => posTotals(p).shares;
export const pCost = p => posTotals(p).cost;
export function pAvg(p) {
  const t = posTotals(p);
  return t.shares > 0 ? t.cost / t.shares : 0;
}

/** Preço médio na moeda de execução (bate com o que a corretora mostra), se todas as entradas o tiverem. */
export function avgDisp(p) {
  const lots = p.lots ?? [];
  const cur = lots[0]?.priceCur;
  if (lots.length && cur && lots.every(l => l.priceQ > 0 && l.priceCur === cur)) {
    let w = 0, s = 0;
    for (const l of lots) { w += l.shares * l.priceQ; s += l.shares; }
    return { value: s > 0 ? w / s : 0, cur };
  }
  return { value: pAvg(p), cur: p.currency };
}

/** Taxa de conversão cambial da corretora (fração, ex: 0.005). */
export const feeFor = platform =>
  NO_FX_FEE.includes(platform) ? 0 : Math.max(0, +state.settings.fxFeePct || 0) / 100;

export const quoteCurOf = p => (p.kind === 'crypto' ? p.currency : p.quoteCur || p.currency);

/** Preço atual na moeda em que cota, se é ao vivo e a variação do dia. */
export function priceInfo(p) {
  if (p.kind === 'crypto') {
    const q = state.cache.prices[p.coingeckoId];
    const k = String(p.currency).toLowerCase();
    if (q?.[k] > 0) return { price: q[k], cur: p.currency, live: true, dayPct: finiteOr(q[`${k}_24h_change`]), ts: q.ts };
    if (q?.usd > 0 && canConvert(p.currency)) {
      return { price: conv(q.usd, 'USD', p.currency), cur: p.currency, live: true, dayPct: finiteOr(q.usd_24h_change), ts: q.ts };
    }
    return { price: pAvg(p), cur: p.currency, live: false, dayPct: null, ts: null };
  }
  const lv = p.quoteSymbol ? state.cache.stockPrices[p.quoteSymbol] : null;
  // Ação noutra moeda só converte ao vivo com câmbio real confirmado; senão usa o preço manual.
  if (lv?.price > 0 && canConvert(lv.cur) && (lv.cur === p.currency || fxFresh())) {
    return { price: lv.price, cur: lv.cur, live: true, dayPct: finiteOr(lv.dayPct), ts: lv.ts };
  }
  return { price: p.manualPrice > 0 ? p.manualPrice : pAvg(p), cur: p.currency, live: false, dayPct: null, ts: null };
}

/**
 * Métricas de uma posição aberta. Os valores "Pos" estão na moeda da conta;
 * os "D" na moeda de visualização (simples conversão dos primeiros, sem taxas extra).
 */
export function metrics(p, cur = disp()) {
  const u = qty(p), cost = pCost(p), pi = priceInfo(p);
  const fee = pi.cur !== p.currency ? feeFor(p.platform) : 0; // a XTB cobra a taxa ao converter na venda
  const valPos = conv(u * pi.price, pi.cur, p.currency) * (1 - fee);
  const plPos = valPos - cost;
  const plp = cost > 0 ? (plPos / cost) * 100 : 0;
  const invD = conv(cost, p.currency, cur), valD = conv(valPos, p.currency, cur), plD = valD - invD;
  const dayD = pi.dayPct != null ? valD - valD / (1 + pi.dayPct / 100) : 0;
  return {
    u, cost, avg: pAvg(p), live: pi.live, ts: pi.ts, nativePrice: pi.price, nativeCur: pi.cur,
    valPos, plPos, plp, invD, valD, plD, dayPct: pi.dayPct, dayD,
  };
}

export function closedM(p, cur = disp()) {
  const u = qty(p), cost = pCost(p), exCur = p.exitCur || p.currency;
  const proceeds = p.proceeds != null ? p.proceeds : conv(u * (p.exitPrice || 0), exCur, p.currency);
  const pl = proceeds - cost, plp = cost > 0 ? (pl / cost) * 100 : 0;
  return { u, exCur, proceeds, pl, plp, invD: conv(cost, p.currency, cur), exD: conv(proceeds, p.currency, cur), plD: conv(pl, p.currency, cur) };
}

export const cashEntries = c => c.entries ?? [];
export const cashBal = c => cashEntries(c).reduce((s, e) => s + e.amount, 0);
export function cashBreak(c) {
  let deposit = 0, interest = 0;
  for (const e of cashEntries(c)) e.kind === 'interest' ? (interest += e.amount) : (deposit += e.amount);
  return { deposit, interest };
}

export function agg(cur = disp()) {
  let inv = 0, val = 0, cryptoV = 0, stockV = 0, dayChange = 0;
  for (const p of state.positions) {
    const m = metrics(p, cur);
    inv += m.invD; val += m.valD; dayChange += m.dayD;
    if (p.kind === 'crypto') cryptoV += m.valD; else stockV += m.valD;
  }
  let cashV = 0;
  for (const c of state.cash) cashV += conv(cashBal(c), c.currency, cur);
  let realized = 0, wins = 0;
  for (const p of state.closed) {
    const m = closedM(p, cur);
    realized += m.plD;
    if (m.pl > 0) wins++;
  }
  const unreal = val - inv;
  return {
    inv, val, cryptoV, stockV, cashV, netWorth: val + cashV, unreal,
    unrealP: inv > 0 ? (unreal / inv) * 100 : 0,
    realized, dayChange, dayP: val - dayChange > 0 ? (dayChange / (val - dayChange)) * 100 : 0,
    winRate: state.closed.length ? (wins / state.closed.length) * 100 : 0,
    closedN: state.closed.length,
  };
}

/**
 * Vende `units` pelo método FIFO (as compras mais antigas primeiro), a regra do IRS.
 * Devolve as frações vendidas, com a data de compra original, e as entradas que ficam.
 */
export function sellFIFO(lots, units, fallbackDate = '') {
  const order = lots
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.date || fallbackDate).localeCompare(b.l.date || fallbackDate) || a.i - b.i);
  const taken = new Map(), sold = [];
  let left = units;
  for (const { l, i } of order) {
    if (left <= units * 1e-12) break;
    const take = Math.min(left, l.shares);
    if (!(take > 0)) continue;
    sold.push({ ...l, shares: take, cost: l.cost * (take / l.shares) });
    taken.set(i, take);
    left -= take;
  }
  const remaining = lots.flatMap((l, i) => {
    const rest = l.shares - (taken.get(i) || 0);
    if (rest <= l.shares * 1e-9) return [];
    return rest === l.shares ? [l] : [{ ...l, shares: rest, cost: l.cost * (rest / l.shares) }];
  });
  return { sold, remaining };
}

/** Junta entradas (ex: ao anular uma venda), voltando a unir frações do mesmo lote. */
export function mergeLots(base, extra) {
  const out = base.map(l => ({ ...l }));
  const unit = l => (l.shares > 0 ? l.cost / l.shares : 0);
  for (const l of extra) {
    const same = out.find(o => o.date === l.date && o.priceQ === l.priceQ && o.priceCur === l.priceCur
      && Math.abs(unit(o) - unit(l)) <= Math.abs(unit(l)) * 1e-9);
    if (same) { same.shares += l.shares; same.cost += l.cost; }
    else out.push({ ...l });
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/**
 * Calcula uma nova entrada (lot).
 * - stock: nº de ações + preço por ação (em priceCur) e, opcionalmente, custo exato ou câmbio usado.
 * - cost: nº de unidades + custo total.
 * - amount: preço por unidade + montante investido.
 */
export function lotCalc({ mode, moneyCur, priceCur = moneyCur, fee = 0, shares, priceQ, cost, rate, price, amount }) {
  if (mode === 'stock') {
    if (!(shares > 0) || !(priceQ > 0)) return { ok: false };
    const cross = priceCur !== moneyCur;
    let total, feeApplied = false, exact = false;
    if (cost > 0) { total = cost; exact = true; }
    else if (rate > 0) { total = shares * priceQ * rate; exact = true; }
    else {
      total = shares * priceQ * conv(1, priceCur, moneyCur) * (cross ? 1 + fee : 1);
      feeApplied = cross && fee > 0;
    }
    if (!Number.isFinite(total)) return { ok: false };
    return { ok: true, units: shares, cost: total, priceQ, priceCur, price: total / shares, feeApplied, exact };
  }
  if (mode === 'cost') {
    if (!(shares > 0) || !(cost > 0)) return { ok: false };
    return { ok: true, units: shares, cost, priceQ: cost / shares, priceCur: moneyCur, price: cost / shares, feeApplied: false, exact: true };
  }
  if (!(price > 0) || !(amount > 0)) return { ok: false };
  return { ok: true, units: amount / price, cost: amount, priceQ: price, priceCur: moneyCur, price, feeApplied: false, exact: false };
}
