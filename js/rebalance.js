import { state } from './store.js';
import { metrics } from './calc.js';

/**
 * Rebalanceamento: alocação alvo por ativo e onde pôr o próximo dinheiro para
 * aproximar a carteira do alvo sem vender nada.
 */

/** Chave do ativo, igual em todas as corretoras (o mesmo ETF na XTB e na TR conta junto). */
export const assetKey = p => (p.kind === 'crypto' ? `c:${p.coingeckoId || p.symbol}` : p.quoteSymbol ? `s:${p.quoteSymbol}` : `p:${p.id}`);

/** Valor atual de cada ativo, juntando corretoras. */
export function holdings(cur) {
  const out = new Map();
  for (const p of state.positions) {
    const k = assetKey(p), v = metrics(p, cur).valD;
    const h = out.get(k) ?? { key: k, name: p.name, value: 0 };
    h.value += v;
    out.set(k, h);
  }
  return [...out.values()].sort((a, b) => b.value - a.value);
}

/** Alvos guardados, só dos ativos que ainda existem, normalizados para somar 100. */
export function activeTargets(list, targets = state.settings.targets ?? {}) {
  const keys = new Set(list.map(h => h.key));
  const t = Object.fromEntries(Object.entries(targets).filter(([k, v]) => keys.has(k) && v > 0));
  const sum = Object.values(t).reduce((s, v) => s + v, 0);
  return sum > 0 ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v / sum) * 100])) : {};
}

/**
 * Sugestão para um novo investimento `amount`: primeiro tapa os ativos abaixo do alvo
 * (proporcionalmente ao que lhes falta); o que sobrar divide-se pelos alvos.
 */
export function suggest(list, targets, amount = 0) {
  const t = activeTargets(list, targets);
  const total = list.reduce((s, h) => s + h.value, 0);
  const after = total + Math.max(0, amount);
  const rows = list.map(h => {
    const target = t[h.key] ?? 0;
    const pct = total > 0 ? (h.value / total) * 100 : 0;
    return { ...h, pct, target, diff: pct - target, gap: Math.max(0, (target / 100) * after - h.value), buy: 0 };
  });
  const gaps = rows.reduce((s, r) => s + r.gap, 0);
  if (amount > 0 && Object.keys(t).length) {
    if (gaps >= amount) for (const r of rows) r.buy = (amount * r.gap) / gaps;
    else for (const r of rows) r.buy = r.gap + ((amount - gaps) * r.target) / 100;
  }
  return { rows, total, hasTargets: Object.keys(t).length > 0 };
}

/** Alvos iguais à distribuição atual (ponto de partida para editar). */
export function currentAsTargets(list) {
  const total = list.reduce((s, h) => s + h.value, 0) || 1;
  return Object.fromEntries(list.map(h => [h.key, Math.round((h.value / total) * 1000) / 10]));
}
