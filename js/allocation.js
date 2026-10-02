import { state } from './store.js';
import { metrics, priceInfo, cashBal } from './calc.js';
import { conv, disp } from './fx.js';
import { byQuote } from './stocks.js';
import { SECTORS, EXCHANGE_COUNTRY, SUFFIX_COUNTRY, OVERRIDES } from './data/classification.js';

export const UNKNOWN = 'Sem dados';
export const CRYPTO = 'Cripto';
const DIVERSIFIED = new Set(['ETF (diversificado)', 'Global', 'Emergentes', UNKNOWN]);
const BASE_SECTORS = new Set(SECTORS);

const etfRegion = x => (/S&P 500|Nasdaq/.test(x) ? 'EUA' : /Emergentes/.test(x) ? 'Emergentes' : 'Global');

function suffixCountry(y) {
  if (!y) return null;
  const m = /(\.[A-Z]{1,2})$/.exec(y);
  return m ? SUFFIX_COUNTRY[m[1]] ?? null : 'EUA';
}

/** Setor e país automáticos (da base local, das correções manuais da base ou da bolsa). */
export function autoClass(p) {
  if (p.kind === 'crypto') return { sector: CRYPTO, country: CRYPTO };
  const y = p.quoteSymbol;
  const s = y ? byQuote(y) : null;
  const [ovSector, ovCountry] = (y && OVERRIDES[y]) || [];
  const isEtf = !!s?.x?.startsWith('ETF');
  const sector = ovSector || (s && BASE_SECTORS.has(s.x) ? s.x : isEtf ? 'ETF (diversificado)' : UNKNOWN);
  const country = ovCountry
    || (isEtf ? etfRegion(s.x) : null)
    || (s && EXCHANGE_COUNTRY[s.x])
    || (s && BASE_SECTORS.has(s.x) ? 'EUA' : null)
    || suffixCountry(y)
    || UNKNOWN;
  return { sector, country };
}

/** Classificação final: a escolha do utilizador tem prioridade sobre a automática. */
export function classify(p) {
  const a = autoClass(p);
  return { sector: p.sector || a.sector, country: p.country || a.country };
}

/** Moeda a que o valor da posição está exposto: a de cotação (cripto à parte). */
export function exposureCurrency(p) {
  if (p.kind === 'crypto') return CRYPTO;
  const pi = priceInfo(p);
  return pi.live ? pi.cur : p.quoteCur || p.currency;
}

/**
 * Distribuição do valor atual por 'sector', 'country' ou 'currency'.
 * Setor e país contam só as posições; a moeda inclui também os fundos/cash.
 */
export function allocation(dim, cur = disp()) {
  const buckets = new Map();
  const add = (k, v) => { if (v > 0) buckets.set(k, (buckets.get(k) || 0) + v); };
  for (const p of state.positions) {
    const v = metrics(p, cur).valD;
    add(dim === 'currency' ? exposureCurrency(p) : classify(p)[dim], v);
  }
  if (dim === 'currency') for (const c of state.cash) add(c.currency, conv(cashBal(c), c.currency, cur));
  const total = [...buckets.values()].reduce((s, v) => s + v, 0);
  const rows = [...buckets]
    .map(([key, value]) => ({ key, value, pct: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => (a.key === UNKNOWN) - (b.key === UNKNOWN) || b.value - a.value);
  return { dim, rows, total, unknownPct: rows.find(r => r.key === UNKNOWN)?.pct ?? 0 };
}

/** Maior concentração num setor/país concreto (ignora ETFs, regiões e cripto), se passar o limite. */
export function concentration(alloc, threshold = 40) {
  if (alloc.dim === 'currency') {
    const outside = alloc.rows.filter(r => r.key !== 'EUR' && r.key !== CRYPTO).reduce((s, r) => s + r.pct, 0);
    return outside >= threshold ? { key: 'fora do euro', pct: outside } : null;
  }
  const top = alloc.rows.find(r => !DIVERSIFIED.has(r.key) && r.key !== CRYPTO);
  return top && top.pct >= threshold ? top : null;
}

/** Posições de ações/ETFs sem setor ou país conhecido. */
export const unclassified = () =>
  state.positions.filter(p => p.kind === 'stock' && Object.values(classify(p)).includes(UNKNOWN));
