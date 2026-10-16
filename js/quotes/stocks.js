import { REFRESH } from '../config.js';
import { state } from '../store.js';
import { fetchJSON, pool } from '../net.js';
import { isCurrency } from '../format.js';
import { micOf, twelveDataSymbol } from '../stocks.js';
import { marketOf, marketStatus, noteSession, extFromChart, FUTURES, futuresWanted, futuresTime } from '../markets.js';
import { cnbcExtended, mergeExtended } from './cnbc.js';

const EXT_WINDOW = 18 * 3600;

/**
 * Com `ext`, pede as últimas 18 h em intervalos de 5 min com o pré e o pós-mercado (ações dos EUA fora do
 * horário normal). Uma janela explícita e não `range=1d`: antes da abertura o "dia" do Yahoo ainda pode ser
 * o de ontem e o pré-mercado de hoje ficava de fora. Arredondada ao minuto para aproveitar a cache.
 */
export function yahooChartUrl(y, ext = false, now = Date.now()) {
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?`;
  if (!ext) return `${base}interval=1d&range=1d`;
  const p2 = Math.ceil(now / 60_000) * 60;
  return `${base}interval=5m&period1=${p2 - EXT_WINDOW}&period2=${p2}&includePrePost=true`;
}
/** Últimos dias em intervalos de 1 h com o pós-mercado: dá o fecho do pós-mercado de ontem. */
const yahooPostUrl = y => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1h&range=5d&includePrePost=true`;
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
 * Com `publicFallback: false` só usa o atalho próprio (se houver).
 */
export async function viaProxies(url, accept, parse, { publicFallback = true } = {}) {
  for (const r of routes(url)) {
    if (!publicFallback && r.id !== 'custom') break;
    let d;
    try { d = await fetchJSON(r.href, { timeout: r.id === 'custom' ? 9000 : 7000 }); } catch { continue; }
    if (!accept(d)) continue;
    if (r.id !== 'custom') state.cache.proxyPref = r.id;
    return parse(d);
  }
  return null;
}

/** Hora do último negócio no horário normal (`mt`, em ms), se vier na resposta. */
const seconds = v => (Number.isFinite(v) && v > 0 ? { mt: v * 1000 } : {});

export function parseYahooChart(d, y = null) {
  const m = d?.chart?.result?.[0]?.meta;
  if (!m || !(m.regularMarketPrice > 0)) return null;
  let price = m.regularMarketPrice, prev = m.previousClose ?? m.chartPreviousClose, cur = m.currency, div = 1;
  if (SUBUNITS[cur]) {
    [cur, div] = SUBUNITS[cur];
    price /= div; prev = prev > 0 ? prev / div : prev;
  }
  if (!isCurrency(cur)) return null;
  const market = marketOf(y);
  if (market) noteSession(market, m);
  const ext = market === 'us' ? extFromChart(d, price, div) : null;
  return {
    price, cur,
    dayPct: prev > 0 ? ((price - prev) / prev) * 100 : null,
    name: typeof (m.longName ?? m.shortName) === 'string' ? (m.longName ?? m.shortName) : null,
    ...seconds(m.regularMarketTime),
    ...(ext ? { ext } : {}),
  };
}

export function parseTwelveData(d) {
  if (!d || d.status === 'error') return null;
  let price = parseFloat(d.close), cur = d.currency;
  if (SUBUNITS[cur]) { price /= SUBUNITS[cur][1]; cur = SUBUNITS[cur][0]; }
  if (!(price > 0) || !isCurrency(cur)) return null;
  const pc = parseFloat(d.percent_change);
  return { price, cur, dayPct: Number.isFinite(pc) ? pc : null, name: typeof d.name === 'string' ? d.name : null, ...seconds(+d.last_quote_at), src: 'twelvedata' };
}

export const yahooQuote = async (y, ext = false) => {
  const q = await viaProxies(yahooChartUrl(y, ext), d => d && typeof d === 'object' && 'chart' in d, d => parseYahooChart(d, y));
  return q && { ...q, src: 'yahoo', ...(q.ext ? { ext: { ...q.ext, src: 'yahoo' } } : {}) };
};

export async function twelveDataQuote(y, key) {
  const mic = micOf(y);
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(twelveDataSymbol(y))}${mic ? `&mic_code=${mic}` : ''}&apikey=${encodeURIComponent(key)}`;
  try { return parseTwelveData(await fetchJSON(url, { timeout: 9000 })); } catch { return null; }
}

/** Fora do horário normal dos EUA vale a pena pedir o pré/pós-mercado. */
const wantsExt = y => marketOf(y) === 'us' && marketStatus('us').phase !== 'open';

const isChart = d => d && typeof d === 'object' && 'chart' in d;

/**
 * Ação dos EUA sem negócios no pré-mercado: mostra o fecho do pós-mercado de ontem, como o Investing.
 * Usa o que já estava guardado ou, uma vez por dia, pede-o ao Yahoo.
 */
export async function withLastPost(y, q, now = Date.now()) {
  if (!q || q.ext || marketOf(y) !== 'us') return q;
  const old = state.cache.stockPrices[y];
  if (old?.ext?.phase === 'post' && old.price === q.price && now - old.ext.at < 20 * 3600_000) return { ...q, ext: old.ext };
  if (marketStatus('us', now).phase !== 'pre' || old?.postChecked === q.price) return old?.postChecked ? { ...q, postChecked: old.postChecked } : q;
  const r = await viaProxies(yahooPostUrl(y), isChart, d => parseYahooChart(d, y)).catch(() => null);
  const ext = r?.ext?.phase === 'post' && Math.abs(r.price - q.price) < q.price * 1e-6 ? r.ext : null;
  return { ...q, ...(ext ? { ext } : {}), postChecked: q.price };
}

/** Cotação de um símbolo: Yahoo (via intermediário) e, como reserva, Twelve Data se houver chave. */
export async function quoteFor(y) {
  const q = await yahooQuote(y, wantsExt(y));
  if (q) return q;
  const key = (state.settings.apiKey || '').trim();
  return key ? twelveDataQuote(y, key) : null;
}

let running = null;

/** Atualiza as cotações das ações/ETFs abertos e dos que estão na lista "A seguir" (3 pedidos em simultâneo). */
export function fetchStockQuotes(opts) {
  running ??= run(opts).finally(() => { running = null; });
  return running;
}

async function run({ force = false } = {}) {
  const syms = [...new Set([...state.positions, ...state.watchlist].filter(p => p.kind === 'stock' && p.quoteSymbol).map(p => p.quoteSymbol))];
  if (!syms.length) return { ok: 0, fail: 0, total: 0 };
  const miss = state.cache.stockMiss;
  const now = Date.now();
  const todo = force ? syms : syms.filter(y => !(now - (miss[y] || 0) < REFRESH.stockMissBackoffMs));
  let ok = 0, fail = 0;
  await pool(todo, 3, async y => {
    const q = await withLastPost(y, await quoteFor(y));
    if (q) {
      state.cache.stockPrices[y] = { ...q, ts: Date.now() };
      for (const p of [...state.positions, ...state.watchlist]) if (p.quoteSymbol === y) p.quoteCur = q.cur;
      delete miss[y];
      ok++;
    }
    else { miss[y] = Date.now(); fail++; }
  });
  if (ok) state.cache.stockUpdated = Date.now();
  const us = syms.filter(y => marketOf(y) === 'us' && state.cache.stockPrices[y]);
  if (us.length) mergeExtended(state.cache.stockPrices, await cnbcExtended(us, viaProxies).catch(() => ({})));
  return { ok, fail, total: syms.length };
}

/** Futuros dos índices dos teus ETFs (e do S&P 500), só fora do horário normal dos EUA. */
export async function fetchFutures(now = Date.now()) {
  if (!futuresTime(now)) return 0;
  const ids = futuresWanted([...state.positions, ...state.watchlist]);
  let got = 0;
  await pool(ids, 2, async id => {
    const y = FUTURES[id].y, q = await yahooQuote(y).catch(() => null);
    if (q) { state.cache.stockPrices[y] = { ...q, ts: Date.now() }; got++; }
  });
  return got;
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
