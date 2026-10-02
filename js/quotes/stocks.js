import { REFRESH } from '../config.js';
import { state } from '../store.js';
import { fetchJSON, pool } from '../net.js';
import { isCurrency } from '../format.js';
import { micOf, twelveDataSymbol } from '../stocks.js';

const yahooChartUrl = y => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=1d`;
const yahooSearchUrl = q => `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`;

/** Intermediários públicos com CORS (gratuitos, por vezes instáveis). O Yahoo não permite pedidos diretos do browser. */
const PUBLIC_PROXIES = [
  { id: 'allorigins', wrap: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { id: 'corsproxy', wrap: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { id: 'codetabs', wrap: u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}` },
];

/** Moedas cotadas em subunidades (ex: pence) → moeda principal. */
const SUBUNITS = { GBp: ['GBP', 100], GBX: ['GBP', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };

export function validProxyUrl(s) {
  try {
    const u = new URL(String(s).trim());
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
  } catch { return false; }
}

function routes(url) {
  const out = [];
  const custom = (state.settings.proxyUrl || '').trim();
  if (custom && validProxyUrl(custom)) {
    out.push({ id: 'custom', href: `${custom}${custom.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}` });
  }
  const pref = state.cache.proxyPref;
  const ordered = [...PUBLIC_PROXIES].sort((a, b) => (b.id === pref) - (a.id === pref));
  for (const p of ordered) out.push({ id: p.id, href: p.wrap(url) });
  return out;
}

/**
 * Tenta cada intermediário até obter uma resposta reconhecida por `accept`.
 * Se a resposta for válida mas sem dados (ex: símbolo inexistente), pára logo.
 */
async function viaProxies(url, accept, parse) {
  for (const r of routes(url)) {
    let d;
    try { d = await fetchJSON(r.href, { timeout: r.id === 'custom' ? 9000 : 7000 }); } catch { continue; }
    if (!accept(d)) continue;
    if (r.id !== 'custom') state.cache.proxyPref = r.id;
    return parse(d);
  }
  return null;
}

export function parseYahooChart(d) {
  const m = d?.chart?.result?.[0]?.meta;
  if (!m || !(m.regularMarketPrice > 0)) return null;
  let price = m.regularMarketPrice, prev = m.previousClose ?? m.chartPreviousClose, cur = m.currency;
  if (SUBUNITS[cur]) {
    const [main, div] = SUBUNITS[cur];
    price /= div; prev = prev > 0 ? prev / div : prev; cur = main;
  }
  if (!isCurrency(cur)) return null;
  return {
    price, cur,
    dayPct: prev > 0 ? ((price - prev) / prev) * 100 : null,
    name: typeof (m.longName ?? m.shortName) === 'string' ? (m.longName ?? m.shortName) : null,
  };
}

export function parseTwelveData(d) {
  if (!d || d.status === 'error') return null;
  let price = parseFloat(d.close), cur = d.currency;
  if (SUBUNITS[cur]) { price /= SUBUNITS[cur][1]; cur = SUBUNITS[cur][0]; }
  if (!(price > 0) || !isCurrency(cur)) return null;
  const pc = parseFloat(d.percent_change);
  return { price, cur, dayPct: Number.isFinite(pc) ? pc : null, name: typeof d.name === 'string' ? d.name : null };
}

export const yahooQuote = y =>
  viaProxies(yahooChartUrl(y), d => d && typeof d === 'object' && 'chart' in d, parseYahooChart);

export async function twelveDataQuote(y, key) {
  const mic = micOf(y);
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(twelveDataSymbol(y))}${mic ? `&mic_code=${mic}` : ''}&apikey=${encodeURIComponent(key)}`;
  try { return parseTwelveData(await fetchJSON(url, { timeout: 9000 })); } catch { return null; }
}

/** Cotação de um símbolo: Yahoo (via intermediário) e, como reserva, Twelve Data se houver chave. */
export async function quoteFor(y) {
  const q = await yahooQuote(y);
  if (q) return q;
  const key = (state.settings.apiKey || '').trim();
  return key ? twelveDataQuote(y, key) : null;
}

let running = null;

/** Atualiza as cotações de todas as ações/ETFs abertos (3 pedidos em simultâneo). */
export function fetchStockQuotes(opts) {
  running ??= run(opts).finally(() => { running = null; });
  return running;
}

async function run({ force = false } = {}) {
  const syms = [...new Set(state.positions.filter(p => p.kind === 'stock' && p.quoteSymbol).map(p => p.quoteSymbol))];
  if (!syms.length) return { ok: 0, fail: 0, total: 0 };
  const miss = state.cache.stockMiss;
  const now = Date.now();
  const todo = force ? syms : syms.filter(y => !(now - (miss[y] || 0) < REFRESH.stockMissBackoffMs));
  let ok = 0, fail = 0;
  await pool(todo, 3, async y => {
    const q = await quoteFor(y);
    if (q) {
      state.cache.stockPrices[y] = { ...q, ts: Date.now() };
      for (const p of state.positions) if (p.quoteSymbol === y) p.quoteCur = q.cur;
      delete miss[y];
      ok++;
    }
    else { miss[y] = Date.now(); fail++; }
  });
  if (ok) state.cache.stockUpdated = Date.now();
  return { ok, fail, total: syms.length };
}

const SEARCH_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND']);

/** Pesquisa global de ações/ETFs no Yahoo (precisa de intermediário). */
export async function searchYahoo(q) {
  const res = await viaProxies(yahooSearchUrl(q), d => d && Array.isArray(d.quotes), d => d.quotes);
  return (res ?? [])
    .filter(x => x && SEARCH_TYPES.has(x.quoteType) && typeof x.symbol === 'string')
    .map(x => ({
      n: String(x.longname || x.shortname || x.symbol),
      t: x.symbol,
      x: [x.exchDisp, x.typeDisp].filter(Boolean).join(' · '),
      y: x.symbol,
      c: null,
      online: true,
    }));
}

/** Série diária de fecho [[AAAA-MM-DD, preço], …] desde `fromISO` (preços em subunidades convertidos). */
export function parseYahooSeries(d) {
  const r = d?.chart?.result?.[0];
  const ts = r?.timestamp, close = r?.indicators?.adjclose?.[0]?.adjclose ?? r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(close)) return null;
  const div = SUBUNITS[r.meta?.currency]?.[1] ?? 1;
  const out = [];
  ts.forEach((t, i) => {
    const c = close[i];
    if (Number.isFinite(t) && c > 0) out.push([new Date(t * 1000).toISOString().slice(0, 10), Math.round((c / div) * 1e4) / 1e4]);
  });
  return out.length ? out : null;
}

export function fetchYahooSeries(y, fromISO) {
  const p1 = Math.floor(Date.parse(fromISO) / 1000), p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?period1=${p1}&period2=${p2}&interval=1d`;
  return viaProxies(url, d => d && typeof d === 'object' && 'chart' in d, parseYahooSeries);
}
