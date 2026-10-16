import { state } from './store.js';
import { conv, disp } from './fx.js';
import { metrics } from './calc.js';
import { histRate, ensureFxHistory } from './tax.js';

/** Custo de uma compra na moeda da ação: pelo preço registado ou, sem ele, pelo câmbio do BCE nesse dia. */
function lotCostQ(l, qc, ac) {
  if (l.priceQ > 0 && l.priceCur === qc) return { v: l.shares * l.priceQ, approx: false };
  const a = histRate(l.date, ac), q = histRate(l.date, qc);
  return a.exact && q.exact ? { v: (l.cost / a.rate) * q.rate, approx: true } : null;
}

/**
 * Resultado de uma ação cotada noutra moeda, separado em duas partes (na moeda da conta):
 * `price` — o que a ação subiu ou desceu na moeda dela, ao câmbio de hoje;
 * `fx` — o resto: o câmbio desde as compras e as taxas de conversão.
 * `r0`/`r1`: câmbio médio das compras (já com taxas) e o de hoje, em moeda da conta por 1 da moeda da ação.
 * null se não se aplica; { missing: true } se falta o câmbio de alguma compra.
 */
export function fxSplit(p) {
  if (p.kind !== 'stock') return null;
  const m = metrics(p, p.currency), qc = m.nativeCur, ac = p.currency;
  if (!m.live || qc === ac || !(m.cost > 0)) return null;
  let costQ = 0, approx = false;
  for (const l of p.lots ?? []) {
    const c = lotCostQ(l, qc, ac);
    if (!c) return { missing: true, qc, ac };
    costQ += c.v;
    approx ||= c.approx;
  }
  if (!(costQ > 0)) return null;
  const r1 = conv(1, qc, ac), price = (m.u * m.nativePrice - costQ) * r1;
  return { qc, ac, costQ, cost: m.cost, r0: m.cost / costQ, r1, price, fx: m.plPos - price, pl: m.plPos, approx };
}

/** Totais por moeda (na moeda de visualização), para o painel. */
export function fxSummary(positions = state.positions, cur = disp()) {
  const groups = new Map();
  let missing = 0;
  for (const p of positions) {
    const s = fxSplit(p);
    if (!s) continue;
    if (s.missing) { missing++; continue; }
    const k = `${s.qc}>${s.ac}`;
    const g = groups.get(k) ?? { qc: s.qc, ac: s.ac, costQ: 0, cost: 0, price: 0, fx: 0, n: 0, approx: false, r1: s.r1 };
    g.costQ += s.costQ; g.cost += s.cost; g.n++;
    g.price += conv(s.price, s.ac, cur); g.fx += conv(s.fx, s.ac, cur);
    g.approx ||= s.approx;
    groups.set(k, g);
  }
  const list = [...groups.values()].map(g => ({ ...g, r0: g.cost / g.costQ, move: (g.r1 / (g.cost / g.costQ) - 1) * 100 }))
    .sort((a, b) => Math.abs(b.price) + Math.abs(b.fx) - Math.abs(a.price) - Math.abs(a.fx));
  return {
    groups: list, missing,
    price: list.reduce((s, g) => s + g.price, 0), fx: list.reduce((s, g) => s + g.fx, 0),
  };
}

const tried = new Set();

/** Vai buscar ao BCE o câmbio dos dias das compras sem preço na moeda da ação (uma vez por sessão). */
export async function ensureLotFx(positions = state.positions) {
  const list = positions.flatMap(p => {
    const s = fxSplit(p);
    return s?.missing ? [s.qc, s.ac].filter(c => c !== 'EUR').map(currency => ({ currency, lots: p.lots })) : [];
  });
  const key = JSON.stringify(list.map(x => [x.currency, x.lots.map(l => l.date)]));
  if (!list.length || tried.has(key)) return false;
  tried.add(key);
  return ensureFxHistory(list, []);
}
