import { STOCKS as BASE } from './data/stocks.js';
import { WORLD } from './data/stocks-world.js';

/** Base local completa: a principal (com ETFs e temáticas) e as restantes ações dos EUA e da Europa. */
const seen = new Set(BASE.map(s => s.y));
export const STOCKS = [...BASE, ...WORLD.filter(s => !seen.has(s.y))];

const BY_QUOTE = new Map(STOCKS.map(s => [s.y, s]));

/** Sufixo Yahoo → código MIC (usado pela Twelve Data). */
const SUFFIX_MIC = {
  '.LS': 'XLIS', '.DE': 'XETR', '.PA': 'XPAR', '.AS': 'XAMS', '.MC': 'XMAD', '.MI': 'XMIL',
  '.L': 'XLON', '.SW': 'XSWX', '.CO': 'XCSE', '.IR': 'XMSM', '.ST': 'XSTO', '.HE': 'XHEL',
  '.BR': 'XBRU', '.OL': 'XOSL', '.VI': 'XWBO',
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

/** Palavras que não ajudam a distinguir ETFs (a moeda base do fundo não é a moeda em que cota). */
const NOISE = new Set(['usd', 'eur', 'gbp', 'chf', 'acc', 'dist', 'ucits', 'etf', 'accumulating', 'distributing']);
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const fold = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const words = s => fold(s).split(/[^a-z0-9&]+/).filter(Boolean);
let WORDS = null;

/**
 * Pesquisa na base local: ticker ou nome a começar pelo texto, depois a contê-lo e, por fim,
 * todas as palavras (ex.: "… USD (Acc)", como algumas corretoras escrevem). Aceita o ISIN.
 */
export function searchLocal(q, limit = 8) {
  const ql = fold(q.trim());
  if (!ql) return [];
  const isin = q.trim().toUpperCase();
  if (ISIN.test(isin)) return STOCKS.filter(s => s.i === isin).slice(0, limit);
  const qw = words(ql).filter(w => !NOISE.has(w));
  WORDS ??= STOCKS.map(s => words(`${s.n} ${s.t}`));
  const starts = [], contains = [], all = [];
  STOCKS.forEach((s, i) => {
    if (starts.length >= limit) return;
    const t = s.t.toLowerCase(), n = fold(s.n);
    if (t === ql || t.startsWith(ql) || n.startsWith(ql)) starts.push(s);
    else if (n.includes(ql) || t.includes(ql)) contains.push(s);
    else if (qw.length && qw.every(w => WORDS[i].some(x => x.startsWith(w)))) all.push(s);
  });
  return [...starts, ...contains, ...all].slice(0, limit);
}

const SUFFIX_CUR = {
  '.DE': 'EUR', '.F': 'EUR', '.SG': 'EUR', '.DU': 'EUR', '.MU': 'EUR', '.HM': 'EUR', '.BE': 'EUR', '.AS': 'EUR', '.PA': 'EUR',
  '.MI': 'EUR', '.MC': 'EUR', '.LS': 'EUR', '.BR': 'EUR', '.IR': 'EUR', '.VI': 'EUR', '.HE': 'EUR',
  '.CO': 'DKK', '.ST': 'SEK', '.OL': 'NOK',
};

/** Moeda em que um símbolo Yahoo cota, quando a bolsa só tem uma (Londres e Zurique têm várias: null). */
export function currencyOfSymbol(y) {
  if (!y || /[=^]/.test(y)) return null;
  const m = /\.[A-Z]{1,3}$/.exec(y);
  return m ? SUFFIX_CUR[m[0]] ?? null : 'USD';
}
