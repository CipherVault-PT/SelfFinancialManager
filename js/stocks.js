import { STOCKS } from './data/stocks.js';

export { STOCKS };

const BY_QUOTE = new Map(STOCKS.map(s => [s.y, s]));

/** Sufixo Yahoo → código MIC (usado pela Twelve Data). */
const SUFFIX_MIC = {
  '.LS': 'XLIS', '.DE': 'XETR', '.PA': 'XPAR', '.AS': 'XAMS', '.MC': 'XMAD', '.MI': 'XMIL',
  '.L': 'XLON', '.SW': 'XSWX', '.CO': 'XCSE', '.IR': 'XMSM', '.ST': 'XSTO', '.HE': 'XHEL',
};

export const byQuote = y => BY_QUOTE.get(y) ?? null;

function suffixOf(y) {
  const m = /(\.[A-Z]{1,2})$/.exec(y ?? '');
  return m && SUFFIX_MIC[m[1]] ? m[1] : '';
}

export const micOf = y => SUFFIX_MIC[suffixOf(y)] ?? '';

/** Símbolo para a Twelve Data: sem sufixo Yahoo e com ponto nas classes de ações dos EUA. */
export function twelveDataSymbol(y) {
  const suf = suffixOf(y);
  if (suf) return y.slice(0, -suf.length);
  return y.replace(/-([A-Z])$/, '.$1');
}

/**
 * Encontra a ação da base local a partir de dados antigos (ticker + bolsa/setor).
 * Devolve null se não existir ou se for ambíguo.
 */
export function resolveStock(symbol, exchange) {
  if (!symbol) return null;
  const direct = BY_QUOTE.get(symbol);
  const matches = STOCKS.filter(s => s.t === symbol);
  if (exchange) {
    const exact = matches.find(s => s.x === exchange);
    if (exact) return exact;
  }
  if (matches.length === 1) return matches[0];
  return direct ?? null;
}

export function searchLocal(q, limit = 8) {
  const ql = q.trim().toLowerCase();
  if (!ql) return [];
  const starts = [], contains = [];
  for (const s of STOCKS) {
    const t = s.t.toLowerCase(), n = s.n.toLowerCase();
    if (t === ql || t.startsWith(ql) || n.startsWith(ql)) starts.push(s);
    else if (n.includes(ql) || t.includes(ql)) contains.push(s);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
