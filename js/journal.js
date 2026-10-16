import { state } from './store.js';
import { closedM, pCost } from './calc.js';
import { disp } from './fx.js';
import { todayISO } from './format.js';

const DAY = 86_400_000;

/** Distância de um preço ao preço atual, em % (positiva = acima). */
export const distance = (level, now) => (level > 0 && now > 0 ? ((level - now) / now) * 100 : null);

/** Dias que a venda esteve na carteira (média das compras, pesada pelo custo). */
export function holdDays(c) {
  const end = Date.parse(c.closedAt);
  if (!Number.isFinite(end)) return null;
  let w = 0, s = 0;
  for (const l of c.lots ?? []) {
    const start = Date.parse(l.date || c.openedAt);
    if (!Number.isFinite(start) || !(l.cost > 0)) continue;
    w += l.cost * Math.max(0, (end - start) / DAY);
    s += l.cost;
  }
  return s > 0 ? Math.round(w / s) : null;
}

export const PERIODS = [['year', 'Ano'], ['12m', '12M'], ['all', 'Tudo']];

export function inPeriod(c, period, now = new Date()) {
  if (period === 'all') return true;
  const d = c.closedAt || '';
  if (period === 'year') return d.startsWith(String(now.getFullYear()));
  const from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);
  return d >= todayISO(from);
}

const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Estatísticas das vendas (cada venda, total ou parcial, é um trade), na moeda de visualização:
 * acerto, ganho/perda médios, rácio entre eles, profit factor, esperança por trade, tempo médio, melhor e pior.
 */
export function tradeStats(closed = state.closed, { period = 'all', cur = disp(), now = new Date() } = {}) {
  const trades = closed.filter(c => inPeriod(c, period, now)).map(c => {
    const m = closedM(c, cur);
    return { c, pl: m.plD, plp: m.plp, cost: pCost(c), days: holdDays(c) };
  });
  const wins = trades.filter(t => t.pl > 0), losses = trades.filter(t => t.pl < 0);
  const sumW = wins.reduce((s, t) => s + t.pl, 0), sumL = losses.reduce((s, t) => s + t.pl, 0);
  const avgWin = avg(wins.map(t => t.pl)), avgLoss = avg(losses.map(t => t.pl));
  const days = list => avg(list.map(t => t.days).filter(d => d != null));
  const byPct = [...trades].sort((a, b) => b.plp - a.plp);
  return {
    n: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    total: sumW + sumL,
    avgWin, avgLoss,
    avgWinPct: avg(wins.map(t => t.plp)), avgLossPct: avg(losses.map(t => t.plp)),
    payoff: avgWin != null && avgLoss ? avgWin / Math.abs(avgLoss) : null,
    profitFactor: sumL ? sumW / Math.abs(sumL) : (sumW > 0 ? Infinity : null),
    expectancy: trades.length ? (sumW + sumL) / trades.length : null,
    avgDays: days(trades), avgDaysWin: days(wins), avgDaysLoss: days(losses),
    best: byPct[0] ?? null, worst: byPct.length > 1 ? byPct.at(-1) : null,
    withNotes: trades.filter(t => t.c.journal || t.c.note).length,
  };
}

/** Observações simples a partir das estatísticas (só com amostra mínima). */
export function insights(st) {
  if (st.n < 5) return [];
  const out = [];
  if (st.avgDaysLoss != null && st.avgDaysWin != null && st.avgDaysLoss > st.avgDaysWin * 1.5 && st.avgDaysLoss - st.avgDaysWin >= 7) {
    out.push(`Seguras as perdas ${Math.round(st.avgDaysLoss)} dias e os ganhos só ${Math.round(st.avgDaysWin)} — o clássico "cortar os ganhos e deixar correr as perdas".`);
  }
  if (st.payoff != null && st.winRate != null) {
    const breakEven = 100 / (1 + st.payoff);
    if (st.winRate < breakEven) out.push(`Com ganhos ${st.payoff.toFixed(1).replace('.', ',')}× as perdas, precisas de acertar em mais de ${breakEven.toFixed(0)}% dos trades para dar lucro — estás nos ${st.winRate.toFixed(0)}%.`);
    else if (st.payoff < 1) out.push(`Acertas muito (${st.winRate.toFixed(0)}%), mas as perdas são maiores do que os ganhos: um stop mais curto ajudava.`);
  }
  return out;
}
