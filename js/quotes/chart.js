import { isCurrency } from '../format.js';
import { conv } from '../fx.js';
import { fetchJSON } from '../net.js';
import { marketOf, latestSession, dateIn, MARKETS } from '../markets.js';
import { viaProxies, SUBUNITS } from './stocks.js';

/** Períodos do gráfico de uma ação: do minuto (1D) ao mês (Máx). `ttl`: quanto tempo os dados ficam em memória. */
export const RANGES = [
  { id: '1d', label: '1D', interval: '1m', ttl: 60_000 },
  { id: '5d', label: '1S', interval: '15m', ttl: 5 * 60_000 },
  { id: '1mo', label: '1M', interval: '60m', ttl: 15 * 60_000 },
  { id: '6mo', label: '6M', interval: '1d', ttl: 3600_000 },
  { id: '1y', label: '1A', interval: '1d', ttl: 3600_000 },
  { id: '5y', label: '5A', interval: '1wk', ttl: 6 * 3600_000 },
  { id: 'max', label: 'Máx', interval: '1mo', ttl: 6 * 3600_000 },
];

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const rangeOf = id => RANGES.find(r => r.id === id) ?? RANGES[0];

/**
 * Endereço do gráfico no Yahoo. No 1D pede a última sessão que começou (nos EUA, do pré ao pós-mercado),
 * porque o "dia" do Yahoo antes da abertura ainda pode ser o de ontem.
 */
export function chartUrl(y, range, now = Date.now()) {
  const r = rangeOf(range), id = marketOf(y);
  const q = new URLSearchParams({ interval: r.interval });
  const s = r.id === '1d' && id ? latestSession(id, now) : null;
  if (s) {
    q.set('period1', String(Math.floor((s.pre ?? s.open) / 1000)));
    q.set('period2', String(Math.ceil(Math.min(now, s.post ?? s.close) / 60_000) * 60));
  } else q.set('range', r.id);
  if (r.id === '1d' && id === 'us') q.set('includePrePost', 'true');
  return `${BASE}${encodeURIComponent(y)}?${q}`;
}

/** { pts: [[ms, preço]…], cur, prev } — preços em subunidades (ex.: pence) já convertidos. */
export function parseChart(d) {
  const r = d?.chart?.result?.[0], m = r?.meta;
  const ts = r?.timestamp, close = r?.indicators?.quote?.[0]?.close;
  if (!m || !Array.isArray(ts) || !Array.isArray(close)) return null;
  const [cur, div] = SUBUNITS[m.currency] ?? [m.currency, 1];
  if (!isCurrency(cur)) return null;
  const pts = [];
  ts.forEach((t, i) => {
    const c = close[i];
    if (Number.isFinite(t) && c > 0) pts.push([t * 1000, c / div]);
  });
  const prev = m.chartPreviousClose ?? m.previousClose;
  return { pts, cur, prev: prev > 0 ? prev / div : null };
}

/** Só o último dia de uma série de vários dias, com o fecho do dia anterior como referência. */
export function lastDay(data, y) {
  const tz = MARKETS[marketOf(y)]?.tz ?? 'UTC', day = t => dateIn(t, tz);
  const last = day(data.pts.at(-1)[0]);
  const i = data.pts.findIndex(p => day(p[0]) === last);
  return { ...data, pts: data.pts.slice(i), prev: i > 0 ? data.pts[i - 1][1] : data.prev };
}

const accept = d => d && typeof d === 'object' && 'chart' in d;
const cache = new Map();

/** Dados do gráfico (null se o Yahoo não responder). Se o 1D vier vazio (feriado, sessão a começar), usa o último dia com negócios. */
export async function fetchChart(y, range, now = Date.now()) {
  const key = `${y}|${range}`, hit = cache.get(key);
  if (hit && now - hit.at < rangeOf(range).ttl) return hit.data;
  let data = await viaProxies(chartUrl(y, range, now), accept, parseChart);
  if (range === '1d' && !(data?.pts.length >= 2)) {
    const wide = await viaProxies(`${BASE}${encodeURIComponent(y)}?range=5d&interval=5m`, accept, parseChart);
    if (wide?.pts.length >= 2) data = lastDay(wide, y);
  }
  if (!(data?.pts.length >= 2)) return null;
  cache.set(key, { at: now, data });
  return data;
}

/* ---------- cripto: CoinGecko (até 1 ano) e Binance (5A, Máx e reserva) ---------- */

const CG = 'https://api.coingecko.com/api/v3/coins/';
const BINANCE = 'https://api.binance.com/api/v3/klines';
/** Dias pedidos à CoinGecko (1 dia → pontos de 5 min; até 90 → de hora a hora; mais → diários). A versão gratuita só dá o último ano. */
const CG_DAYS = { '1d': 1, '5d': 7, '1mo': 30, '6mo': 180, '1y': 365 };
/** Velas da Binance por período: [intervalo, quantidade]. */
const KLINES = { '1d': ['5m', 288], '5d': ['1h', 168], '1mo': ['4h', 180], '6mo': ['1d', 183], '1y': ['1d', 365], '5y': ['1w', 261], max: ['1M', 1000] };

export const coinChartUrl = (id, cur, range) =>
  `${CG}${encodeURIComponent(id)}/market_chart?vs_currency=${cur.toLowerCase()}&days=${CG_DAYS[range] ?? 365}`;

export const klinesUrl = (pair, range) => `${BINANCE}?symbol=${pair}&interval=${KLINES[range][0]}&limit=${KLINES[range][1]}`;

/** Resposta da CoinGecko → { pts, cur, prev: null }. */
export function parseCoinChart(d, cur) {
  const pts = (Array.isArray(d?.prices) ? d.prices : [])
    .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && p[1] > 0).map(p => [p[0], p[1]]);
  return pts.length >= 2 ? { pts, cur, prev: null, src: 'coingecko' } : null;
}

/** Velas da Binance → { pts } com o fecho de cada vela (`rate` converte de dólares, aproximado). */
export function parseKlines(d, cur, rate = 1) {
  const pts = (Array.isArray(d) ? d : [])
    .map(k => [k?.[0], parseFloat(k?.[4]) * rate]).filter(p => Number.isFinite(p[0]) && p[1] > 0);
  return pts.length >= 2 ? { pts, cur, prev: null, src: 'binance', approx: rate !== 1 } : null;
}

async function fromBinance(symbol, cur, range) {
  const s = String(symbol || '').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(s)) return null;
  // primeiro o par na moeda da posição (ex.: BTCEUR); senão em USDT, convertido ao câmbio de hoje
  if (cur !== 'USD') {
    const d = await fetchJSON(klinesUrl(`${s}${cur}`, range), { timeout: 9000 }).catch(() => null);
    const got = d && parseKlines(d, cur);
    if (got) return got;
  }
  const d = await fetchJSON(klinesUrl(`${s}USDT`, range), { timeout: 9000 }).catch(() => null);
  const rate = cur === 'USD' ? 1 : conv(1, 'USD', cur);
  return d && rate > 0 ? parseKlines(d, cur, rate) : null;
}

/**
 * Gráfico de uma criptomoeda ({ id da CoinGecko, symbol, cur }). Até 1 ano vem da CoinGecko; 5A e Máx
 * (e se a CoinGecko falhar, ex.: limite de pedidos) vêm da Binance. Sem nenhuma das duas, 5A/Máx mostram o último ano.
 */
export async function fetchCoinChart(coin, range, now = Date.now()) {
  const cur = coin.cur === 'USD' ? 'USD' : 'EUR';
  const key = `cg:${coin.id}|${cur}|${range}`, hit = cache.get(key);
  if (hit && now - hit.at < rangeOf(range).ttl) return hit.data;
  let data = null;
  if (CG_DAYS[range]) {
    data = parseCoinChart(await fetchJSON(coinChartUrl(coin.id, cur, range), { timeout: 10_000 }).catch(() => null), cur);
  }
  data ??= await fromBinance(coin.symbol, cur, range);
  if (!data && !CG_DAYS[range]) {
    const year = parseCoinChart(await fetchJSON(coinChartUrl(coin.id, cur, '1y'), { timeout: 10_000 }).catch(() => null), cur);
    data = year && { ...year, capped: true };
  }
  if (data) cache.set(key, { at: now, data });
  return data;
}

